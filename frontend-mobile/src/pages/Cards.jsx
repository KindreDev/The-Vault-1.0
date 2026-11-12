import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import { Layers, X, Star, ChevronLeft, ChevronRight } from 'lucide-react'
import TCGV2CardFace from '@desktop/components/tcg-v2/TCGV2CardFace'
import { tcgApi } from '../lib/api.js'
import { abs } from '../lib/server.js'
import { PageHeader, Spinner, Empty } from '../components/ui.jsx'
import { usePersistentState, useBackClose } from '../lib/nav.js'

// Your card collection, drawn with the same card faces as the desktop app.

const TYPES = [
  { id: '',             label: 'All' },
  { id: 'scene',        label: 'Scene' },
  { id: 'cosplay',      label: 'Cosplay' },
  { id: 'gallery',      label: 'Gallery' },
  { id: 'character',    label: 'Character' },
  { id: 'creator',      label: 'Creator' },
  { id: 'collab',       label: 'Collab' },
  { id: 'bond',         label: 'Bond' },
  { id: 'hall-of-fame', label: 'Hall of Fame' },
]
const RARITIES = ['C', 'R', 'SR', 'UR', 'SPR']
const RARITY_COLOR = { C: '#9a9a9a', R: '#4C9BE8', SR: '#A66CF0', UR: '#F0B429', SPR: '#F06292' }
const PAGE = 24

// Card art paths come back relative to the PC. Make every one absolute, and
// let grid tiles use the server's 720px preview instead of the full original.
const FULL_IMAGE = /^\/api\/images\/(\d+)\/file(?:\?.*)?$/
function absCard(value, preview) {
  if (typeof value === 'string') {
    if (!value.startsWith('/')) return value
    const m = preview && value.match(FULL_IMAGE)
    return abs(m ? `/api/images/${m[1]}/preview?w=720` : value)
  }
  if (Array.isArray(value)) return value.map(v => absCard(v, preview))
  if (value && typeof value === 'object') {
    const out = {}
    for (const [k, v] of Object.entries(value)) out[k] = absCard(v, preview)
    return out
  }
  return value
}
const isHof = (card) => card?.card_type === 'hof' || card?.card_type === 'hall-of-fame'

function useGridWidth() {
  const ref = useRef(null)
  const [cols, setCols] = useState(2)
  useEffect(() => {
    const measure = () => {
      const w = ref.current?.clientWidth || window.innerWidth - 32
      setCols(Math.max(2, Math.floor((w + 10) / 170)))
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])
  return { ref, cols }
}

// Card faces are heavy SVG; only mount the ones near the screen.
function LazyFace({ card, onClick }) {
  const ref = useRef(null)
  const [show, setShow] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || !('IntersectionObserver' in window)) { setShow(true); return }
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setShow(true); io.disconnect() } }, { rootMargin: '300px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [])
  return (
    <div ref={ref} onClick={onClick} style={{ aspectRatio: '5 / 7', width: '100%' }}>
      {show && <TCGV2CardFace card={card} width="100%" fallback={<FaceFallback card={card} />} />}
    </div>
  )
}

function FaceFallback({ card }) {
  return (
    <div className="w-full h-full rounded-xl flex flex-col items-center justify-center gap-1 text-center p-2"
         style={{ background: 'var(--c-card)', color: 'rgba(255,255,255,0.45)' }}>
      <span className="text-[13px] font-semibold">{card?.print_rarity || card?.rarity_class}</span>
      <span className="text-[12px]">Art unavailable</span>
    </div>
  )
}

export default function Cards() {
  const [type, setType] = usePersistentState('vault.m.cards.type', '')
  const [rarity, setRarity] = usePersistentState('vault.m.cards.rarity', '')
  const [viewer, setViewer] = useState(null)
  const grid = useGridWidth()
  const sentinel = useRef(null)

  const { data: summary } = useQuery({ queryKey: ['tcg-summary'], queryFn: () => tcgApi.summary().then(r => r.data) })

  const params = { ownership: 'owned', card_type: type || undefined, rarity: rarity || undefined }
  const query = useInfiniteQuery({
    queryKey: ['tcg-owned', type, rarity],
    queryFn: ({ pageParam = 0 }) => tcgApi.catalog({ ...params, skip: pageParam, limit: PAGE }).then(r => r.data),
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((n, p) => n + (p.items?.length || 0), 0)
      return loaded < (last.total || 0) ? loaded : undefined
    },
    initialPageParam: 0,
  })
  const items = useMemo(() => (query.data?.pages || []).flatMap(p => p.items || []), [query.data])
  const total = query.data?.pages?.[0]?.total ?? 0

  // Tiles get preview-sized art; the viewer gets the untouched card.
  const tiles = useMemo(() => items.map(it => ({
    ...it,
    tileCard: it.card ? absCard(it.card, !isHof(it.card)) : null,
    fullCard: it.card ? absCard(it.card, false) : null,
  })), [items])

  useEffect(() => {
    const el = sentinel.current
    if (!el) return
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting && query.hasNextPage && !query.isFetchingNextPage) query.fetchNextPage()
    }, { rootMargin: '600px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [query.hasNextPage, query.isFetchingNextPage, query.fetchNextPage])

  return (
    <div>
      <PageHeader title="Cards" right={
        <span className="text-[14px]" style={{ color: 'rgba(255,255,255,0.5)' }}>
          {summary ? `${summary.owned_printings} owned · ${summary.owned_copies} copies` : ''}
        </span>
      } />

      <div data-hswipe className="flex gap-2 overflow-x-auto px-4 pb-2" style={{ scrollbarWidth: 'none' }}>
        {TYPES.map(t => (
          <button key={t.id || 'all'} onClick={() => setType(t.id)}
                  className="shrink-0 px-3.5 py-1.5 rounded-full text-[14px] font-medium"
                  style={{ background: type === t.id ? 'var(--accent)' : 'var(--c-card)', color: type === t.id ? '#fff' : 'rgba(255,255,255,0.6)' }}>
            {t.label}
          </button>
        ))}
      </div>
      <div data-hswipe className="flex gap-2 overflow-x-auto px-4 pb-3" style={{ scrollbarWidth: 'none' }}>
        <button onClick={() => setRarity('')}
                className="shrink-0 px-3 py-1 rounded-full text-[13px]"
                style={{ background: !rarity ? 'rgba(255,255,255,0.14)' : 'transparent', color: 'rgba(255,255,255,0.7)', border: '1px solid rgba(255,255,255,0.12)' }}>
          Any rarity
        </button>
        {RARITIES.map(r => (
          <button key={r} onClick={() => setRarity(rarity === r ? '' : r)}
                  className="shrink-0 px-3 py-1 rounded-full text-[13px] font-semibold"
                  style={{ background: rarity === r ? RARITY_COLOR[r] : 'transparent', color: rarity === r ? '#111' : RARITY_COLOR[r],
                           border: `1px solid ${RARITY_COLOR[r]}66` }}>
            {r}
          </button>
        ))}
      </div>

      {query.isLoading ? <Spinner /> : !tiles.length ? (
        <Empty icon={<Layers size={40} />} text="No cards here yet" />
      ) : (
        <div ref={grid.ref} className="px-4"
             style={{ display: 'grid', gridTemplateColumns: `repeat(${grid.cols}, minmax(0, 1fr))`, gap: 10 }}>
          {tiles.map((it, idx) => (
            <div key={it.id} className="min-w-0">
              {it.tileCard ? <LazyFace card={it.tileCard} onClick={() => setViewer(idx)} /> : <FaceFallback card={it} />}
              <div className="mt-1.5 flex items-center gap-1.5 min-w-0">
                <span className="text-[11px] font-bold shrink-0" style={{ color: RARITY_COLOR[it.rarity] || '#aaa' }}>{it.rarity}</span>
                <span className="text-[12px] truncate" style={{ color: 'rgba(255,255,255,0.7)' }}>{it.identity?.display_name}</span>
                {it.quantity > 1 && <span className="text-[11px] shrink-0 ml-auto" style={{ color: 'rgba(255,255,255,0.4)' }}>×{it.quantity}</span>}
              </div>
            </div>
          ))}
        </div>
      )}
      <div ref={sentinel} className="h-10" />
      {query.isFetchingNextPage && <Spinner />}
      {!query.isLoading && total > 0 && !query.hasNextPage && (
        <div className="text-center text-[12px] pb-4" style={{ color: 'rgba(255,255,255,0.25)' }}>{total} cards</div>
      )}

      {viewer !== null && tiles[viewer] && (
        <CardViewer items={tiles} index={viewer} onIndex={setViewer} onClose={() => setViewer(null)} />
      )}
    </div>
  )
}

function CardViewer({ items, index, onIndex, onClose }) {
  const qc = useQueryClient()
  const it = items[index]
  const card = it.fullCard
  const [favorite, setFavorite] = useState(!!it.favorite)
  const touch = useRef(null)
  useEffect(() => { setFavorite(!!it.favorite) }, [it.id, it.favorite])
  useBackClose(true, onClose)

  // Freeze the grid behind the viewer so drags work the card, not the page.
  useEffect(() => {
    const html = document.documentElement, body = document.body
    const prev = [html.style.overflow, body.style.overflow, body.style.overscrollBehavior]
    html.style.overflow = 'hidden'; body.style.overflow = 'hidden'; body.style.overscrollBehavior = 'none'
    return () => { [html.style.overflow, body.style.overflow, body.style.overscrollBehavior] = prev }
  }, [])

  const go = useCallback((d) => {
    const next = index + d
    if (next >= 0 && next < items.length) onIndex(next)
  }, [index, items.length, onIndex])

  const toggleFavorite = () => {
    const next = !favorite
    setFavorite(next)
    tcgApi.setFavorite(it.identity?.card_id ?? card.id, next)
      .then(() => qc.invalidateQueries({ queryKey: ['tcg-owned'] }))
      .catch(() => setFavorite(!next))
  }

  // Swipe sideways to move between cards; a drag that stays put tilts the card.
  const onTouchStart = (e) => { const t = e.touches[0]; touch.current = { x: t.clientX, y: t.clientY } }
  const onTouchEnd = (e) => {
    const s = touch.current; touch.current = null
    if (!s) return
    const t = e.changedTouches[0]
    const dx = t.clientX - s.x, dy = t.clientY - s.y
    if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.5) go(dx < 0 ? 1 : -1)
  }

  const id = it.identity || {}
  return createPortal(
    <div data-hswipe className="fixed inset-0 z-[70] flex flex-col"
         style={{ background: 'rgba(8,8,10,0.97)', touchAction: 'none', overscrollBehavior: 'contain' }}
         onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      <div className="flex items-center gap-2 px-3 pt-[calc(var(--sat)+10px)] pb-2">
        <button onClick={onClose} className="p-2 rounded-full active:bg-white/10" aria-label="Close"><X size={22} /></button>
        <div className="flex-1 text-center text-[13px]" style={{ color: 'rgba(255,255,255,0.4)' }}>{index + 1} / {items.length}</div>
        <button onClick={toggleFavorite} className="p-2 rounded-full active:bg-white/10" aria-label="Favorite">
          <Star size={22} color="var(--c-amber)" fill={favorite ? 'var(--c-amber)' : 'none'} />
        </button>
      </div>

      <div className="flex-1 min-h-0 flex items-center justify-center px-6">
        <div style={{ width: 'min(86vw, calc((100vh - 260px) * 5 / 7))' }}>
          <TCGV2CardFace key={it.id} card={card} width="100%" showEffects videoPresentation="full"
                         fallback={<FaceFallback card={card} />} />
        </div>
      </div>

      <div className="px-5 pb-[calc(var(--sab)+18px)] pt-3">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-bold px-2 py-0.5 rounded" style={{ background: `${RARITY_COLOR[it.rarity] || '#888'}33`, color: RARITY_COLOR[it.rarity] || '#aaa' }}>{it.rarity}</span>
          <span className="text-[17px] font-semibold truncate">{id.display_name}</span>
        </div>
        <div className="mt-1 text-[13px]" style={{ color: 'rgba(255,255,255,0.45)' }}>
          {[id.card_code, id.catalog_code && `${id.catalog_code} #${id.display_number}`, it.quantity > 1 && `×${it.quantity} copies`].filter(Boolean).join(' · ')}
        </div>
        {card?.level && (
          <div className="mt-2.5 flex items-center gap-2 text-[12px]" style={{ color: 'rgba(255,255,255,0.5)' }}>
            <span>Lv {card.level}/{card.level_max}</span>
            <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.08)' }}>
              <div className="h-full rounded-full" style={{ width: `${card.cxp_for_next ? Math.min(100, (card.cxp / card.cxp_for_next) * 100) : 100}%`, background: 'var(--accent)' }} />
            </div>
          </div>
        )}
        <div className="flex justify-between mt-3">
          <button onClick={() => go(-1)} disabled={index === 0} className="p-2.5 rounded-full disabled:opacity-25" style={{ background: 'var(--c-card)' }} aria-label="Previous"><ChevronLeft size={20} /></button>
          <button onClick={() => go(1)} disabled={index >= items.length - 1} className="p-2.5 rounded-full disabled:opacity-25" style={{ background: 'var(--c-card)' }} aria-label="Next"><ChevronRight size={20} /></button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

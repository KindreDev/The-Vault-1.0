import { useState, useEffect, useMemo, useRef } from 'react'
import { AnimatePresence } from 'framer-motion'
import { useQuery } from '@tanstack/react-query'
import { Layers, ChevronLeft, ChevronRight } from 'lucide-react'
import { cardsApi } from '../lib/api.js'
import { PageHeader, Spinner, Empty } from '../components/ui.jsx'
import VaultCard, { RARITY_CONFIG } from '../components/VaultCard.jsx'
import CardViewer from '../components/CardViewer.jsx'

const FILTERS = ['', 'common', 'uncommon', 'rare', 'epic', 'legendary', 'relic', 'celestial']
const PAGE_SIZE = 10   // cap rendered cards per page so the holo foil never tanks performance

// Adaptive grid measured from the real container (window.innerWidth lies in
// some WebViews) — CSS grid guarantees the column count, so it can NEVER
// collapse to one card per row. Min 2 columns always.
function useCardGrid(gap = 10, minCard = 140, maxCard = 200) {
  const ref = useRef(null)
  const [layout, setLayout] = useState({ cols: 2, width: 150 })
  useEffect(() => {
    const measure = () => {
      const w = ref.current?.clientWidth || (window.innerWidth - 32)
      const cols = Math.max(2, Math.floor((w + gap) / (minCard + gap)))
      setLayout({ cols, width: Math.min(maxCard, Math.floor((w - gap * (cols - 1)) / cols)) })
    }
    measure()
    const t = setTimeout(measure, 50)   // re-measure after first paint
    window.addEventListener('resize', measure)
    return () => { clearTimeout(t); window.removeEventListener('resize', measure) }
  }, [])
  return { ref, ...layout, gap }
}

export default function Cards() {
  const [rarity, setRarity] = useState('')
  const [page, setPage] = useState(0)
  const [viewerIdx, setViewerIdx] = useState(null)
  const grid = useCardGrid()

  const { data: dist } = useQuery({ queryKey: ['rarity-dist'], queryFn: () => cardsApi.rarityDistribution().then(r => r.data) })
  const { data, isLoading } = useQuery({
    queryKey: ['cards', rarity],
    queryFn: () => cardsApi.inventory({ rarity: rarity || undefined }).then(r => r.data),
  })

  // Reset to the first page whenever the filter changes.
  useEffect(() => { setPage(0) }, [rarity])

  const items = data?.items || []
  const pageCount = Math.max(1, Math.ceil(items.length / PAGE_SIZE))
  const pageItems = useMemo(
    () => items.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE),
    [items, page]
  )

  return (
    <div>
      <PageHeader title="Cards" right={
        <span className="text-[15px]" style={{ color: 'rgba(255,255,255,0.5)' }}>{dist?.total ?? 0} owned</span>
      } />

      <div className="flex gap-2 overflow-x-auto px-4 pb-3">
        {FILTERS.map(r => {
          const meta = RARITY_CONFIG[r]
          const count = r ? (dist?.by_rarity?.[r] ?? 0) : dist?.total
          return (
            <button key={r || 'all'} onClick={() => setRarity(r)}
                    className="shrink-0 px-3.5 py-1.5 rounded-full text-[14px] font-medium"
                    style={{
                      background: rarity === r ? (meta?.badge || 'var(--accent)') : 'var(--c-card)',
                      color: rarity === r ? '#fff' : 'rgba(255,255,255,0.6)',
                    }}>
              {meta?.label || 'All'} {count ? `(${count})` : ''}
            </button>
          )
        })}
      </div>

      {isLoading ? <Spinner /> : !items.length ? (
        <Empty icon={<Layers size={40} />} text="No cards in this category" />
      ) : (
        <>
          <div ref={grid.ref} className="px-4"
               style={{ display: 'grid', gridTemplateColumns: `repeat(${grid.cols}, 1fr)`, gap: grid.gap, justifyItems: 'center' }}>
            {pageItems.map((card, idx) => (
              <VaultCard key={card.inventory_id} card={card} width={grid.width}
                         onClick={() => setViewerIdx(idx)} />
            ))}
          </div>

          {pageCount > 1 && (
            <div className="flex items-center justify-center gap-4 mt-5">
              <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
                      className="p-2.5 rounded-full" style={{ background: 'var(--c-card)', opacity: page === 0 ? 0.3 : 1 }}>
                <ChevronLeft size={22} color="#fff" />
              </button>
              <span className="text-[15px]" style={{ color: 'rgba(255,255,255,0.6)' }}>{page + 1} / {pageCount}</span>
              <button onClick={() => setPage(p => Math.min(pageCount - 1, p + 1))} disabled={page >= pageCount - 1}
                      className="p-2.5 rounded-full" style={{ background: 'var(--c-card)', opacity: page >= pageCount - 1 ? 0.3 : 1 }}>
                <ChevronRight size={22} color="#fff" />
              </button>
            </div>
          )}
        </>
      )}
      <div className="h-4" />

      <AnimatePresence>
        {viewerIdx !== null && (
          <CardViewer
            cards={pageItems}
            index={viewerIdx}
            onIndexChange={setViewerIdx}
            onClose={() => setViewerIdx(null)}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

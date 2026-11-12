import { useQuery } from '@tanstack/react-query'
import { Hash } from 'lucide-react'
import { insightsApi } from '../../lib/api'
import { useT } from '../../i18n'
import RailTabsCard, { catColor } from './RailTabsCard'

const rowStyle = { background: 'rgba(255,255,255,0.03)', border: '0.5px solid rgba(255,255,255,0.06)' }

function TagRow({ tag, right, onClick }) {
  return (
    <button onClick={onClick}
            className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-[7px] w-full text-left cursor-pointer transition-colors hover:bg-[rgba(255,255,255,0.07)]"
            style={rowStyle}>
      <span className="flex items-center gap-2 min-w-0">
        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: catColor(tag.category) }} />
        <span className="truncate" style={{ fontSize: 16, color: 'rgba(255,255,255,0.78)' }}>{tag.name}</span>
      </span>
      <span className="flex items-center gap-1.5 flex-shrink-0" style={{ fontSize: 16 }}>{right}</span>
    </button>
  )
}

function Empty({ children }) {
  return <div className="px-1 py-2" style={{ fontSize: 16, color: 'rgba(255,255,255,0.4)' }}>{children}</div>
}

// Tags card on the Dashboard rail. Only content and looks tags are ranked:
// baseline tags (breasts, long hair), people count, framing and Spice would
// win every list and say nothing.
export default function TagsCard({ onTagClick, onPairClick, onPairTagClick }) {
  const t = useT()
  const opts = { staleTime: 300000, retry: false, refetchOnWindowFocus: false }
  const { data: taste } = useQuery({ queryKey: ['insights', 'taste'], queryFn: () => insightsApi.taste(8).then(r => r.data), ...opts })
  const { data: trending } = useQuery({ queryKey: ['insights', 'trending'], queryFn: () => insightsApi.trending(8).then(r => r.data), ...opts })
  const { data: top } = useQuery({ queryKey: ['insights', 'top'], queryFn: () => insightsApi.top(8).then(r => r.data), ...opts })
  const { data: pairs } = useQuery({ queryKey: ['insights', 'together'], queryFn: () => insightsApi.together(8).then(r => r.data), ...opts })
  const maxUse = Math.max(1, ...(top ?? []).map(tag => tag.use_count ?? 0))

  const tabs = [
    { id: 'foryou', label: t('For you'), content: taste?.length ? (
      <div className="flex flex-col gap-1.5">
        {taste.map(tag => (
          <TagRow key={tag.id} tag={tag} onClick={() => onTagClick(tag.name)}
                  right={<span style={{ color: 'var(--c-pink-text)', fontWeight: 600 }} title={t('How much more this shows up in what you finish to than in your library')}>
                    {tag.lift.toFixed(1)}×
                  </span>} />
        ))}
      </div>
    ) : <Empty>{t('Your taste profile appears once you have logged a few cums, edges or ratings.')}</Empty> },
    { id: 'trending', label: t('Trending'), content: trending?.length ? (
      <div className="flex flex-col gap-1.5">
        {trending.map(tag => (
          <TagRow key={tag.id} tag={tag} onClick={() => onTagClick(tag.name)}
                  right={<span style={{ color: 'var(--c-green)', fontWeight: 600 }} title={t('Rise in what you watched this week vs the four weeks before')}>
                    ↑{tag.rise.toFixed(1)}×
                  </span>} />
        ))}
      </div>
    ) : <Empty>{t('Nothing is trending yet. Trends come from what you watch and finish to this week.')}</Empty> },
    { id: 'top', label: t('Top'), content: (
      <div className="flex flex-col gap-1.5">
        {(top ?? []).map(tag => (
          <button key={tag.id} onClick={() => onTagClick(tag.name)} className="w-full text-left cursor-pointer">
            <div className="flex items-center justify-between mb-0.5">
              <span className="truncate" style={{ fontSize: 16, color: 'rgba(255,255,255,0.72)' }}>{tag.name}</span>
              <span style={{ fontSize: 16, color: 'var(--c-amber)', fontWeight: 700, marginLeft: 6, flexShrink: 0 }}>{(tag.use_count ?? 0).toLocaleString()}</span>
            </div>
            <div style={{ height: 3, borderRadius: 99, background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${((tag.use_count ?? 0) / maxUse) * 100}%`, background: catColor(tag.category), borderRadius: 99 }} />
            </div>
          </button>
        ))}
      </div>
    ) },
    { id: 'together', label: t('Together'), content: pairs?.length ? (
      <div className="flex flex-col gap-1.5">
        {pairs.map(p => (
          <div key={`${p.tag1.id}-${p.tag2.id}`} onClick={() => onPairClick(p.tag1.name, p.tag2.name)}
               className="flex items-center gap-1 flex-wrap px-2 py-1.5 rounded-[7px] cursor-pointer transition-colors hover:bg-[color-mix(in_srgb,var(--c-accent)_7%,transparent)]"
               style={rowStyle} title={t('Together {n}× more often than chance', { n: p.lift })}>
            {[p.tag1, p.tag2].map((tag, i) => (
              <span key={tag.id} className="flex items-center gap-1">
                {i === 1 && <span style={{ fontSize: 16, color: 'rgba(255,255,255,0.25)' }}>+</span>}
                <button onClick={e => { e.stopPropagation(); onPairTagClick(tag.name) }}
                        className="px-1.5 py-0.5 rounded cursor-pointer hover:opacity-75"
                        style={{ fontSize: 16, color: catColor(tag.category), background: `color-mix(in srgb, ${catColor(tag.category)} 12%, transparent)` }}>
                  {tag.name}
                </button>
              </span>
            ))}
            <span className="ml-auto" style={{ fontSize: 16, color: 'rgba(255,255,255,0.35)' }}>{p.lift}×</span>
          </div>
        ))}
      </div>
    ) : <Empty>{t('Working out which tags go together…')}</Empty> },
  ]
  return <RailTabsCard icon={Hash} iconColor="var(--c-accent)" title={t('Tags')} tabs={tabs} />
}

import { useQuery } from '@tanstack/react-query'
import { Sparkles, Play } from 'lucide-react'
import { insightsApi } from '../../lib/api'
import { useT } from '../../i18n'

// Viewer sidebar: files that share this one's most distinctive tags and Spice,
// mostly from other galleries. Clicking plays them as a run in this viewer.
export default function MoreLikeThis({ imageId, onPlay }) {
  const t = useT()
  const { data: items = [], isFetching } = useQuery({
    queryKey: ['insights', 'similar', imageId],
    queryFn: () => insightsApi.similar(imageId, 12).then(r => r.data),
    enabled: !!imageId,
    staleTime: 600000,
  })
  if (!items.length && !isFetching) return null
  return (
    <div className="px-3 pb-3">
      <div className="flex items-center gap-1.5 mb-2 text-[16px] font-medium uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.35)' }}>
        <Sparkles size={14} style={{ color: 'var(--c-accent)' }} /> {t('More like this')}
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        {items.map((item, i) => (
          <button key={item.id} type="button" onClick={() => onPlay(items, i)}
                  title={item.gallery_name}
                  className="relative rounded-[6px] overflow-hidden cursor-pointer group"
                  style={{ aspectRatio: '3 / 4', background: 'rgba(255,255,255,0.04)' }}>
            <img src={`/api/images/${item.id}/thumb`} alt="" loading="lazy"
                 className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                 onError={e => { e.currentTarget.style.display = 'none' }} />
            {item.is_video && (
              <span className="absolute top-1 right-1 rounded-full p-0.5" style={{ background: 'rgba(0,0,0,0.6)', color: 'white' }}>
                <Play size={10} fill="currentColor" />
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  )
}

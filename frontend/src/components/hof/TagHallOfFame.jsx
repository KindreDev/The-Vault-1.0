import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Flame, Film, Hash, Images, Search, Users } from 'lucide-react'
import { insightsApi, tagsApi } from '../../lib/api'
import { useT } from '../../i18n'

const PREF_KEY = 'vault.tagHof.tag'

function readTag() {
  try { return JSON.parse(localStorage.getItem(PREF_KEY) || 'null') } catch { return null }
}
function saveTag(tag) {
  try { localStorage.setItem(PREF_KEY, JSON.stringify(tag)) } catch { /* private mode */ }
}

function avatarUrl(creator) {
  if (!creator.avatar_path) return null
  const bust = encodeURIComponent(creator.avatar_path.split(/[\\/]/).pop() || '')
  return `/api/creators/${creator.id}/avatar-thumb?size=240&v=${bust}`
}

function Rank({ n }) {
  const color = n === 1 ? '#F5C542' : n === 2 ? '#C9D1D9' : n === 3 ? '#D08B5B' : 'rgba(255,255,255,0.55)'
  return <span className="absolute top-2 left-2 z-[2] px-2 rounded-full text-[16px] font-bold"
               style={{ background: 'rgba(0,0,0,0.65)', color }}>#{n}</span>
}

function Stats({ item, t }) {
  return (
    <div className="flex items-center gap-2 text-[16px] text-white/50">
      {item.cum_count > 0 && <span style={{ color: 'var(--c-pink-text)' }}>{item.cum_count} 💦</span>}
      {item.edge_count > 0 && <span>{item.edge_count} {t('edges')}</span>}
      {!!item.view_count && <span>{item.view_count} {t('views')}</span>}
    </div>
  )
}

function MediaRow({ title, icon: Icon, items, onClick, t }) {
  if (!items?.length) return null
  return (
    <div>
      <div className="flex items-center gap-2 mb-3 text-[18px] font-semibold text-white/80"><Icon size={18} /> {title}</div>
      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))' }}>
        {items.map(item => (
          <button key={item.id} type="button" onClick={() => onClick(item.id)}
                  className="rounded-[10px] overflow-hidden text-left cursor-pointer group"
                  style={{ background: 'rgba(255,255,255,0.04)', border: '0.5px solid rgba(255,255,255,0.08)' }}>
            <div className="relative overflow-hidden" style={{ height: 220 }}>
              <img src={`/api/images/${item.id}/thumb`} alt="" loading="lazy"
                   className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                   onError={e => { e.currentTarget.style.display = 'none' }} />
              <Rank n={item.rank} />
            </div>
            <div className="p-2.5">
              <div className="text-[16px] text-white/70 truncate">{item.gallery_name}</div>
              <Stats item={item} t={t} />
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}

// Hall of Fame for one tag: the best files, galleries and creators for, say,
// underboob, scored like the main Hall of Fame and following its period.
export default function TagHallOfFame({ period, ago = 0, onMediaClick, onGalleryClick, onCreatorClick }) {
  const t = useT()
  const [picked, setPicked] = useState(readTag)
  const [query, setQuery] = useState('')
  const { data: taste = [] } = useQuery({ queryKey: ['insights', 'taste', 12], queryFn: () => insightsApi.taste(12).then(r => r.data), staleTime: 300000 })
  const { data: allTags = [] } = useQuery({ queryKey: ['tags'], queryFn: () => tagsApi.list().then(r => r.data), staleTime: 300000 })
  const tag = picked || (taste[0] ? { id: taste[0].id, name: taste[0].name } : null)
  const { data, isFetching } = useQuery({
    queryKey: ['insights', 'tag-hof', tag?.id, period, ago],
    queryFn: () => insightsApi.tagHof(tag.id, period, 15, ago).then(r => r.data),
    enabled: !!tag, staleTime: 30000,
  })

  const choose = next => { setPicked(next); saveTag(next); setQuery('') }
  const q = query.trim().toLowerCase()
  const results = useMemo(() => (q
    ? allTags.filter(x => (x.role === 'content' || x.role === 'looks') && x.name.includes(q)).slice(0, 8)
    : []), [allTags, q])

  return (
    <section>
      <div className="flex items-start justify-between gap-4 flex-wrap mb-5">
        <div>
          <div className="flex items-center gap-2.5 text-[24px] font-bold text-white/90">
            <Hash size={22} style={{ color: 'var(--c-pink)' }} /> {t('Tag Hall of Fame')}
            {tag && <span className="text-[20px] font-semibold" style={{ color: 'var(--c-pink-text)' }}>· {tag.name}</span>}
          </div>
          <p className="text-[16px] text-white/45 mt-1">{t('The best of one thing. Your favourite tags are listed first.')}</p>
        </div>
        <div className="relative">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full" style={{ background: 'rgba(255,255,255,0.05)', border: '0.5px solid rgba(255,255,255,0.12)', width: 240 }}>
            <Search size={15} className="text-white/40" />
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder={t('Any tag…')}
                   className="flex-1 bg-transparent outline-none text-[16px] min-w-0" style={{ color: 'rgba(255,255,255,0.88)' }} />
          </div>
          {!!results.length && (
            <div className="absolute right-0 top-full mt-1 z-20 rounded-[10px] overflow-hidden shadow-2xl animate-menu-pop"
                 style={{ background: '#1e1e1e', border: '0.5px solid rgba(255,255,255,0.15)', width: 240 }}>
              {results.map(x => (
                <button key={x.id} type="button" onClick={() => choose({ id: x.id, name: x.name })}
                        className="w-full flex items-center justify-between px-3 py-2 text-[16px] text-white/80 cursor-pointer hover:bg-[rgba(255,255,255,0.06)]">
                  <span className="truncate">{x.name}</span>
                  <span className="text-white/35">{x.use_count.toLocaleString()}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {!!taste.length && (
        <div className="flex gap-2 flex-wrap mb-6">
          {taste.map(x => {
            const active = tag?.id === x.id
            return (
              <button key={x.id} type="button" onClick={() => choose({ id: x.id, name: x.name })}
                      className="flex items-center gap-1.5 px-3 py-1 rounded-full text-[16px] cursor-pointer"
                      style={{
                        background: active ? 'color-mix(in srgb, var(--c-pink) 22%, transparent)' : 'rgba(255,255,255,0.04)',
                        color: active ? 'var(--c-pink-text)' : 'rgba(255,255,255,0.6)',
                        border: `0.5px solid ${active ? 'color-mix(in srgb, var(--c-pink) 45%, transparent)' : 'rgba(255,255,255,0.08)'}`,
                      }}>
                <Flame size={13} /> {x.name}
              </button>
            )
          })}
        </div>
      )}

      {!tag ? (
        <p className="text-[16px] text-white/45">{t('Pick a tag to see its Hall of Fame.')}</p>
      ) : !data ? (
        <p className="text-[16px] text-white/45">{isFetching ? t('Loading…') : ''}</p>
      ) : !data.files_scored ? (
        <p className="text-[16px] text-white/45">{t('Nothing tagged {tag} has any views, edges or cums in this period yet.', { tag: tag.name })}</p>
      ) : (
        <div className="flex flex-col gap-8">
          {!!data.creators?.length && (
            <div>
              <div className="flex items-center gap-2 mb-3 text-[18px] font-semibold text-white/80"><Users size={18} /> {t('Creators')}</div>
              <div className="flex gap-4 flex-wrap">
                {data.creators.map(c => (
                  <button key={c.id} type="button" onClick={() => onCreatorClick(c.id)}
                          className="flex flex-col items-center gap-1.5 w-[104px] cursor-pointer group">
                    <div className="relative w-[88px] h-[88px] rounded-full overflow-hidden" style={{ border: '2px solid rgba(255,255,255,0.12)' }}>
                      {avatarUrl(c) && <img src={avatarUrl(c)} alt="" className="w-full h-full object-cover group-hover:scale-105 transition-transform" />}
                    </div>
                    <span className="text-[16px] text-white/75 truncate w-full text-center">#{c.rank} {c.name}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          <MediaRow title={t('Photos')} icon={Images} items={data.photos} onClick={onMediaClick} t={t} />
          <MediaRow title={t('Videos')} icon={Film} items={data.videos} onClick={onMediaClick} t={t} />
          {!!data.galleries?.length && (
            <div>
              <div className="flex items-center gap-2 mb-3 text-[18px] font-semibold text-white/80"><Images size={18} /> {t('Galleries')}</div>
              <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))' }}>
                {data.galleries.map(g => (
                  <button key={g.id} type="button" onClick={() => onGalleryClick(g.id)}
                          className="rounded-[10px] overflow-hidden text-left cursor-pointer group"
                          style={{ background: 'rgba(255,255,255,0.04)', border: '0.5px solid rgba(255,255,255,0.08)' }}>
                    <div className="relative overflow-hidden" style={{ height: 180 }}>
                      {g.cover_thumb && <img src={g.cover_thumb} alt="" loading="lazy" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" style={{ objectPosition: 'top center' }} />}
                      <Rank n={g.rank} />
                    </div>
                    <div className="p-2.5 text-[16px] text-white/70 truncate">{g.name}</div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  )
}

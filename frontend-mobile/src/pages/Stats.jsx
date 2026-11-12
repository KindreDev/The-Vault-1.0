import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useQuery } from '@tanstack/react-query'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Crown, Droplet, Flame, Eye, Clock, TrendingUp, TrendingDown, Play, Trophy, Sparkles, X, User } from 'lucide-react'
import { statsApi } from '../lib/api.js'
import { creatorAvatarUrl, imageThumbUrl, coverUrl } from '../lib/media.js'
import { abs } from '../lib/server.js'
import { PageHeader, Spinner, Empty } from '../components/ui.jsx'
import { useBackClose } from '../lib/nav.js'

// Hall of Fame + Recap, read-only. Same numbers as the desktop pages.

const HOF_PERIODS = [
  { id: 'day', label: 'Today' }, { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' }, { id: 'all', label: 'All time' },
]
const RECAP_PERIODS = [
  { id: 'week', label: 'This week' }, { id: 'month', label: 'This month' }, { id: 'year', label: 'This year' },
]
const MEDALS = ['#F0B429', '#C0C7D0', '#CD8B5A']

const fmtDuration = (secs) => {
  const s = Math.round(secs || 0)
  if (s >= 3600) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
  if (s >= 60) return `${Math.floor(s / 60)}m`
  return `${s}s`
}
const loadPref = (key, fallback, allowed) => {
  try { const v = localStorage.getItem(key); return allowed.some(p => p.id === v) ? v : fallback } catch { return fallback }
}
const savePref = (key, v) => { try { localStorage.setItem(key, v) } catch {} }

export default function Stats() {
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') === 'recap' ? 'recap' : 'hof'
  return (
    <div>
      <PageHeader title={tab === 'hof' ? 'Hall of Fame' : 'Recap'} />
      <div className="flex gap-1 mx-4 mb-4 p-1 rounded-full" style={{ background: 'var(--c-card)' }}>
        {[['hof', 'Hall of Fame'], ['recap', 'Recap']].map(([id, label]) => (
          <button key={id} onClick={() => setParams({ tab: id }, { replace: true })}
                  className="flex-1 py-2 rounded-full text-[14px] font-medium"
                  style={{ background: tab === id ? 'var(--accent)' : 'transparent', color: tab === id ? '#fff' : 'rgba(255,255,255,0.55)' }}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'hof' ? <HallOfFame /> : <Recap />}
      <div className="h-6" />
    </div>
  )
}

function PeriodChips({ periods, value, onChange }) {
  return (
    <div data-hswipe className="flex gap-2 overflow-x-auto px-4 pb-3" style={{ scrollbarWidth: 'none' }}>
      {periods.map(p => (
        <button key={p.id} onClick={() => onChange(p.id)}
                className="shrink-0 px-3.5 py-1.5 rounded-full text-[14px]"
                style={{ background: value === p.id ? 'rgba(255,255,255,0.14)' : 'transparent',
                         color: value === p.id ? '#fff' : 'rgba(255,255,255,0.5)', border: '1px solid rgba(255,255,255,0.1)' }}>
          {p.label}
        </button>
      ))}
    </div>
  )
}

function SectionTitle({ icon, children }) {
  return <h2 className="flex items-center gap-2 px-4 mt-6 mb-2.5 text-lg font-bold">{icon}{children}</h2>
}

// ── Hall of Fame ─────────────────────────────────────────────────────────────
function HallOfFame() {
  const nav = useNavigate()
  const [statsId, setStatsId] = useState(null)
  const [period, setPeriodState] = useState(() => loadPref('vault.m.hofPeriod', 'all', HOF_PERIODS))
  const setPeriod = (p) => { setPeriodState(p); savePref('vault.m.hofPeriod', p) }

  const creators = useQuery({ queryKey: ['m-hof-creators', period], queryFn: () => statsApi.creatorHof(20, period).then(r => r.data) })
  const media    = useQuery({ queryKey: ['m-hof-media', period],    queryFn: () => statsApi.mediaHof(18, period).then(r => r.data) })
  const gals     = useQuery({ queryKey: ['m-hof-galleries', period], queryFn: () => statsApi.galleryHof(10, period).then(r => r.data) })

  const list = creators.data || []
  const podium = list.slice(0, 3)
  const rest = list.slice(3)

  return (
    <>
      <PeriodChips periods={HOF_PERIODS} value={period} onChange={setPeriod} />
      {creators.isLoading ? <Spinner /> : !list.length ? (
        <Empty icon={<Trophy size={40} />} text="Nothing logged for this period yet" />
      ) : (
        <>
          {/* Podium */}
          <div className="grid grid-cols-3 gap-2.5 px-4 items-end">
            {[podium[1], podium[0], podium[2]].map((c, slot) => {
              if (!c) return <div key={slot} />
              const place = slot === 1 ? 0 : slot === 0 ? 1 : 2
              return (
                <button key={c.id} onClick={() => setStatsId(c.id)} className="flex flex-col items-center text-center min-w-0">
                  <div className="relative" style={{ width: place === 0 ? 96 : 76 }}>
                    <img src={creatorAvatarUrl(c.id, 320)} alt="" loading="lazy"
                         onError={e => { e.target.style.visibility = 'hidden' }}
                         className="w-full aspect-square rounded-full object-cover"
                         style={{ border: `3px solid ${MEDALS[place]}`, background: 'var(--c-card)' }} />
                    {place === 0 && <Crown size={26} className="absolute -top-5 left-1/2 -translate-x-1/2" color={MEDALS[0]} fill={MEDALS[0]} />}
                    <span className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-6 h-6 rounded-full text-[12px] font-bold flex items-center justify-center"
                          style={{ background: MEDALS[place], color: '#111' }}>{place + 1}</span>
                  </div>
                  <div className="mt-3 text-[14px] font-semibold truncate w-full">{c.name}</div>
                  <div className="text-[12px]" style={{ color: 'rgba(255,255,255,0.45)' }}>{(c.hof_score ?? c.score ?? 0).toLocaleString()} pts</div>
                </button>
              )
            })}
          </div>

          {rest.length > 0 && (
            <div className="mx-4 mt-5 rounded-vault overflow-hidden" style={{ background: 'var(--c-card)' }}>
              {rest.map(c => (
                <button key={c.id} onClick={() => setStatsId(c.id)}
                        className="w-full flex items-center gap-3 px-3 py-2.5 text-left active:bg-white/5"
                        style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                  <span className="w-6 text-[14px] font-bold text-center" style={{ color: 'rgba(255,255,255,0.4)' }}>{c.rank}</span>
                  <img src={creatorAvatarUrl(c.id, 160)} alt="" loading="lazy" onError={e => { e.target.style.visibility = 'hidden' }}
                       className="w-10 h-10 rounded-full object-cover shrink-0" style={{ background: 'var(--c-surface)' }} />
                  <div className="flex-1 min-w-0">
                    <div className="text-[15px] truncate">{c.name}</div>
                    <div className="flex gap-3 text-[12px]" style={{ color: 'rgba(255,255,255,0.4)' }}>
                      <span className="flex items-center gap-1"><Droplet size={11} />{c.total_cum ?? 0}</span>
                      <span className="flex items-center gap-1"><Flame size={11} />{c.total_edges ?? 0}</span>
                      <span className="flex items-center gap-1"><Eye size={11} />{c.total_views ?? 0}</span>
                    </div>
                  </div>
                  <RankChange value={c.rank_change} />
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {(media.data || []).length > 0 && (
        <>
          <SectionTitle icon={<Sparkles size={18} style={{ color: 'var(--accent)' }} />}>Top photos and videos</SectionTitle>
          <div className="grid grid-cols-3 gap-1.5 px-4">
            {media.data.map(m => (
              <button key={m.id} onClick={() => nav(m.is_video ? `/video/${m.id}` : `/photo/${m.id}`)}
                      className="relative aspect-square rounded-lg overflow-hidden" style={{ background: 'var(--c-card)' }}>
                <img src={imageThumbUrl(m)} alt="" loading="lazy" className="w-full h-full object-cover" />
                <span className="absolute top-1 left-1 px-1.5 rounded text-[11px] font-bold" style={{ background: 'rgba(0,0,0,0.6)' }}>#{m.rank}</span>
                {m.is_video && <Play size={16} className="absolute bottom-1.5 right-1.5" fill="#fff" />}
                {m.cum_count > 0 && (
                  <span className="absolute bottom-1 left-1 flex items-center gap-0.5 px-1.5 rounded text-[11px]" style={{ background: 'rgba(0,0,0,0.6)', color: '#F0A3BD' }}>
                    <Droplet size={10} />{m.cum_count}
                  </span>
                )}
              </button>
            ))}
          </div>
        </>
      )}

      {(gals.data || []).length > 0 && (
        <>
          <SectionTitle icon={<Trophy size={18} style={{ color: 'var(--c-amber)' }} />}>Top galleries</SectionTitle>
          <div data-hswipe className="flex gap-3 overflow-x-auto px-4 pb-1">
            {gals.data.map((g, i) => (
              <button key={g.id} onClick={() => nav(`/gallery/${g.id}`)} className="shrink-0 w-32 text-left">
                <div className="relative w-32 h-44 rounded-vault overflow-hidden" style={{ background: 'var(--c-card)' }}>
                  {coverUrl(g) && <img src={coverUrl(g)} alt="" loading="lazy" className="w-full h-full object-cover" />}
                  <span className="absolute top-1.5 left-1.5 px-1.5 rounded text-[11px] font-bold" style={{ background: 'rgba(0,0,0,0.6)' }}>#{g.rank ?? i + 1}</span>
                </div>
                <div className="mt-1.5 text-[14px] truncate">{g.name}</div>
              </button>
            ))}
          </div>
        </>
      )}
      {statsId && <CreatorStatsSheet id={statsId} onClose={() => setStatsId(null)} />}
    </>
  )
}

function CreatorStatsSheet({ id, onClose }) {
  const nav = useNavigate()
  const { data: s, isLoading } = useQuery({ queryKey: ['m-creator-stats', id], queryFn: () => statsApi.creatorStats(id).then(r => r.data) })
  useEffect(() => {
    const html = document.documentElement, body = document.body
    const prev = [html.style.overflow, body.style.overflow]
    html.style.overflow = 'hidden'; body.style.overflow = 'hidden'
    return () => { html.style.overflow = prev[0]; body.style.overflow = prev[1] }
  }, [])
  useBackClose(true, onClose)
  const go = (path) => { onClose(); nav(path) }
  const crowns = s?.crowns?.counts || {}
  const top = s?.most_gooned_image
  const gal = s?.most_viewed_gallery
  return createPortal(
    <div data-hswipe className="fixed inset-0 z-[70] flex flex-col justify-end">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative rounded-t-2xl flex flex-col" style={{ background: 'var(--c-surface)', maxHeight: '88vh' }}>
        <div className="flex justify-center pt-3 pb-1"><div className="h-1.5 w-10 rounded-full bg-white/20" /></div>
        <button onClick={onClose} className="absolute top-3 right-3 p-2 rounded-full active:bg-white/10" aria-label="Close"><X size={20} /></button>
        <div className="overflow-y-auto px-4 pb-[calc(var(--sab)+20px)]" style={{ overscrollBehavior: 'contain' }}>
          {isLoading || !s ? <Spinner /> : (
            <>
              <div className="flex items-center gap-3 mt-1 pr-10">
                <img src={creatorAvatarUrl(id, 240)} alt="" onError={e => { e.target.style.visibility = 'hidden' }}
                     className="w-16 h-16 rounded-full object-cover shrink-0"
                     style={{ background: 'var(--c-card)', border: `2.5px solid ${MEDALS[(s.rank || 99) - 1] || 'var(--accent)'}` }} />
                <div className="min-w-0">
                  <div className="text-xl font-bold truncate">{s.name}</div>
                  <div className="text-[13px]" style={{ color: 'rgba(255,255,255,0.5)' }}>
                    #{s.rank} of {s.total_creators} · {(s.hof_score || 0).toLocaleString()} pts
                  </div>
                  {s.points_to_first > 0 && (
                    <div className="text-[12px]" style={{ color: 'rgba(255,255,255,0.4)' }}>{s.points_to_first.toLocaleString()} pts behind #1</div>
                  )}
                </div>
              </div>

              {s.crowns?.total > 0 && (
                <div className="mt-4 rounded-vault p-3 flex items-center gap-3" style={{ background: 'color-mix(in srgb, #F0B429 12%, var(--c-card))' }}>
                  <Crown size={22} color="#F0B429" fill="#F0B429" />
                  <div className="flex-1">
                    <div className="text-[15px] font-semibold">{s.crowns.total} crowns</div>
                    <div className="text-[12px]" style={{ color: 'rgba(255,255,255,0.5)' }}>
                      {[crowns.day && `${crowns.day} daily`, crowns.week && `${crowns.week} weekly`,
                        crowns.month && `${crowns.month} monthly`, crowns.alltime && `${crowns.alltime} all-time`].filter(Boolean).join(' · ')}
                    </div>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-3 gap-2 mt-3">
                <Metric label="Cum" value={s.cum_count} color="#F0A3BD" />
                <Metric label="Edges" value={s.edge_count} />
                <Metric label="Sessions" value={s.session_count} />
                <Metric label="Time" value={fmtDuration(s.total_view_seconds)} />
                <Metric label="Views" value={(s.total_views || 0).toLocaleString()} />
                <Metric label="Cum / hour" value={s.os_per_hour ?? 0} />
              </div>
              <div className="mt-2 text-[12px] px-1" style={{ color: 'rgba(255,255,255,0.45)' }}>
                {s.share_of_total_cum ?? 0}% of all your cum · {s.share_of_total_time ?? 0}% of your time
              </div>

              {(top || gal) && (
                <div className="grid grid-cols-2 gap-2.5 mt-4">
                  {top && (
                    <button onClick={() => go(top.is_video ? `/video/${top.id}` : `/photo/${top.id}`)} className="text-left min-w-0">
                      <div className="aspect-square rounded-vault overflow-hidden" style={{ background: 'var(--c-card)' }}>
                        <img src={abs(`/api/images/${top.id}/preview?w=480`)} alt="" className="w-full h-full object-cover" />
                      </div>
                      <div className="mt-1 text-[12px]" style={{ color: 'rgba(255,255,255,0.55)' }}>Most used · {top.cum_count} cum</div>
                    </button>
                  )}
                  {gal && (
                    <button onClick={() => go(`/gallery/${gal.id}`)} className="text-left min-w-0">
                      <div className="aspect-square rounded-vault overflow-hidden" style={{ background: 'var(--c-card)' }}>
                        {coverUrl(gal) && <img src={coverUrl(gal)} alt="" className="w-full h-full object-cover" />}
                      </div>
                      <div className="mt-1 text-[12px] truncate" style={{ color: 'rgba(255,255,255,0.55)' }}>Top gallery · {gal.name}</div>
                    </button>
                  )}
                </div>
              )}

              <div className="flex justify-around py-3 mt-4 rounded-vault text-center" style={{ background: 'var(--c-card)' }}>
                {[['Galleries', s.gallery_count], ['Photos', s.photo_count], ['Videos', s.video_count], ['Bond', s.bond_level]].map(([l, v]) => (
                  <div key={l}>
                    <div className="text-[16px] font-bold">{(v ?? 0).toLocaleString()}</div>
                    <div className="text-[11px]" style={{ color: 'rgba(255,255,255,0.4)' }}>{l}</div>
                  </div>
                ))}
              </div>

              <button onClick={() => go(`/creator/${id}`)}
                      className="w-full mt-4 py-3 rounded-full text-[15px] font-semibold flex items-center justify-center gap-2"
                      style={{ background: 'var(--accent)' }}>
                <User size={17} /> Open profile
              </button>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}

function RankChange({ value }) {
  if (!value) return <span className="w-8" />
  const up = value > 0
  return (
    <span className="w-8 flex items-center justify-end gap-0.5 text-[12px]" style={{ color: up ? 'var(--c-green)' : 'var(--c-pink)' }}>
      {up ? <TrendingUp size={12} /> : <TrendingDown size={12} />}{Math.abs(value)}
    </span>
  )
}

// ── Recap ────────────────────────────────────────────────────────────────────
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function Recap() {
  const nav = useNavigate()
  const [period, setPeriodState] = useState(() => loadPref('vault.m.recapPeriod', 'month', RECAP_PERIODS))
  const setPeriod = (p) => { setPeriodState(p); savePref('vault.m.recapPeriod', p) }
  const avail = useQuery({ queryKey: ['m-recap-avail'], queryFn: () => statsApi.recapAvailability().then(r => r.data) })
  const deck = useQuery({
    queryKey: ['m-recap', period], enabled: !!avail.data?.unlocked,
    queryFn: () => statsApi.recap(period).then(r => r.data),
  })

  if (avail.isLoading) return <Spinner />
  if (avail.data && !avail.data.unlocked) {
    const pct = Math.min(100, Math.round((avail.data.tracked_seconds / avail.data.required_seconds) * 100))
    return (
      <div className="px-6 py-14 text-center">
        <div className="text-lg font-semibold">Recap unlocks after a few hours of use</div>
        <div className="mt-3 h-2 rounded-full overflow-hidden" style={{ background: 'var(--c-card)' }}>
          <div className="h-full rounded-full" style={{ width: `${pct}%`, background: 'var(--accent)' }} />
        </div>
        <div className="mt-2 text-[13px]" style={{ color: 'rgba(255,255,255,0.4)' }}>{pct}% there</div>
      </div>
    )
  }

  const cards = deck.data?.cards || []
  const by = Object.fromEntries(cards.map(c => [c.type, c]))
  const o = by.opening, v = by.volume, clock = by.clock, rhythm = by.rhythm
  return (
    <>
      <PeriodChips periods={RECAP_PERIODS} value={period} onChange={setPeriod} />
      {deck.isLoading ? <Spinner /> : deck.data?.empty || !cards.length ? (
        <Empty icon={<Clock size={40} />} text="Nothing logged in this period yet" />
      ) : (
        <div className="px-4 flex flex-col gap-3">
          {o && (
            <div className="rounded-vault p-4" style={{ background: 'color-mix(in srgb, var(--accent) 18%, var(--c-card))' }}>
              <div className="text-[13px]" style={{ color: 'rgba(255,255,255,0.5)' }}>{o.range}</div>
              <div className="text-2xl font-bold mt-0.5">{o.title}</div>
              <div className="text-[14px] mt-1" style={{ color: 'rgba(255,255,255,0.65)' }}>
                {o.active_days} active days · {(o.xp || 0).toLocaleString()} XP
              </div>
              {by.closing?.headline && <div className="text-[14px] mt-2 italic" style={{ color: 'rgba(255,255,255,0.8)' }}>{by.closing.headline}</div>}
            </div>
          )}

          {v && (
            <div className="grid grid-cols-2 gap-2.5">
              <Metric label="Sessions" value={v.sessions} delta={v.deltas?.sessions} />
              <Metric label="Time logged" value={fmtDuration(v.session_secs)} delta={v.deltas?.session_secs} />
              <Metric label="Cum" value={v.cum} delta={v.deltas?.cum} color="#F0A3BD" />
              <Metric label="Longest session" value={fmtDuration(v.longest_sec)} />
            </div>
          )}

          {by.countdown?.creators?.length > 0 && (
            <Card title="Your top creators">
              {/* The PC sends these 5th → 1st for desktop's countdown reveal. */}
              {[...by.countdown.creators].reverse().map((c, i) => (
                <button key={c.id} onClick={() => nav(`/creator/${c.id}`)} className="w-full flex items-center gap-3 py-2 text-left">
                  <span className="w-5 text-[14px] font-bold" style={{ color: MEDALS[i] || 'rgba(255,255,255,0.4)' }}>{i + 1}</span>
                  <img src={creatorAvatarUrl(c.id, 160)} alt="" loading="lazy" onError={e => { e.target.style.visibility = 'hidden' }}
                       className="w-10 h-10 rounded-full object-cover" style={{ background: 'var(--c-surface)' }} />
                  <div className="flex-1 min-w-0">
                    <div className="text-[15px] truncate">{c.name}</div>
                    <div className="text-[12px]" style={{ color: 'rgba(255,255,255,0.4)' }}>
                      {c.sessions} sessions · {c.cum} cum · {c.views} views
                    </div>
                  </div>
                </button>
              ))}
            </Card>
          )}

          {clock?.hours?.length > 0 && (
            <Card title="When you play" sub={`Peak around ${clock.peak_hour}:00 · ${clock.night_share}% at night`}>
              <Bars values={clock.hours} labels={['0', '3', '6', '9', '12', '15', '18', '21']} />
            </Card>
          )}

          {rhythm?.days?.length > 0 && (
            <Card title="Your week" sub={`Busiest on ${DAYS[rhythm.peak_day]} · longest streak ${rhythm.streak?.longest ?? 0} days`}>
              <Bars values={rhythm.days} labels={DAYS.map(d => d[0])} />
            </Card>
          )}

          {by.devotion && (
            <Card title="Devotion" sub={`${by.devotion.top3_share}% of your time went to your top 3, out of ${by.devotion.roster} creators`}>
              <div className="text-[14px]" style={{ color: 'rgba(255,255,255,0.75)' }}>{(by.devotion.names || []).join(' · ')}</div>
            </Card>
          )}

          {by.newcomer?.creator && (
            <Card title="Newcomer" sub="New to your rotation">
              <button onClick={() => nav(`/creator/${by.newcomer.creator.id}`)} className="flex items-center gap-3">
                <img src={creatorAvatarUrl(by.newcomer.creator.id, 160)} alt="" className="w-12 h-12 rounded-full object-cover" style={{ background: 'var(--c-surface)' }} />
                <div className="text-left">
                  <div className="text-[15px] font-semibold">{by.newcomer.creator.name}</div>
                  <div className="text-[12px]" style={{ color: 'rgba(255,255,255,0.4)' }}>{by.newcomer.creator.sessions} sessions</div>
                </div>
              </button>
            </Card>
          )}

          {by.relic?.image && (
            <Card title="The one" sub={`${by.relic.image.cum} cum · ${by.relic.image.gallery_name || ''}`}>
              <button onClick={() => nav(by.relic.image.is_video ? `/video/${by.relic.image.id}` : `/photo/${by.relic.image.id}`)}
                      className="w-full rounded-lg overflow-hidden" style={{ background: 'var(--c-surface)' }}>
                <img src={imageThumbUrl(by.relic.image)} alt="" className="w-full max-h-80 object-cover" />
              </button>
            </Card>
          )}

          {by.archetype && (
            <Card title={by.archetype.name} sub={by.archetype.blurb}>
              <div className="flex flex-wrap gap-1.5">
                {(by.archetype.axes || []).map(a => (
                  <span key={a.axis} className="px-2.5 py-1 rounded-full text-[12px]" style={{ background: 'var(--c-surface)', color: 'rgba(255,255,255,0.7)' }}>{a.label}</span>
                ))}
              </div>
            </Card>
          )}

          {by.growth && (
            <div className="grid grid-cols-2 gap-2.5">
              <Metric label="Files in the vault" value={(by.growth.files || 0).toLocaleString()} />
              <Metric label="Galleries" value={(by.growth.galleries || 0).toLocaleString()} />
            </div>
          )}
        </div>
      )}
    </>
  )
}

function Card({ title, sub, children }) {
  return (
    <div className="rounded-vault p-4" style={{ background: 'var(--c-card)' }}>
      <div className="text-[16px] font-semibold">{title}</div>
      {sub && <div className="text-[13px] mt-0.5 mb-2.5" style={{ color: 'rgba(255,255,255,0.45)' }}>{sub}</div>}
      {!sub && <div className="h-2" />}
      {children}
    </div>
  )
}

function Metric({ label, value, delta, color }) {
  return (
    <div className="rounded-vault p-3" style={{ background: 'var(--c-card)' }}>
      <div className="text-xl font-bold" style={{ color }}>{value ?? 0}</div>
      <div className="flex items-center gap-1.5 text-[12px]" style={{ color: 'rgba(255,255,255,0.45)' }}>
        {label}
        {typeof delta === 'number' && (
          <span style={{ color: delta >= 0 ? 'var(--c-green)' : 'var(--c-pink)' }}>{delta >= 0 ? '+' : ''}{delta}%</span>
        )}
      </div>
    </div>
  )
}

function Bars({ values, labels }) {
  const max = Math.max(1, ...values)
  return (
    <div>
      <div className="flex items-end gap-1.5 h-20">
        {values.map((v, i) => (
          <div key={i} className="flex-1 rounded-t" style={{ height: `${Math.max(4, (v / max) * 100)}%`, background: v === max ? 'var(--accent)' : 'rgba(255,255,255,0.15)' }} />
        ))}
      </div>
      <div className="flex gap-1.5 mt-1">
        {labels.map((l, i) => <div key={i} className="flex-1 text-center text-[11px]" style={{ color: 'rgba(255,255,255,0.35)' }}>{l}</div>)}
      </div>
    </div>
  )
}

/**
 * <GalleryStatsModal /> — the gallery-level counterpart to the creator stats
 * modal. Opened from the Hall of Fame (card or full list).
 */
import React from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  Images, TrendingUp, Star, Calendar, Trophy, Droplets, Waves,
  Clock, Eye, Tag as TagIcon, Film, HardDrive, ArrowUpRight,
} from 'lucide-react'
import { galleriesApi } from '../../lib/api'
import {
  StatsModalShell, LoadingBody, Panel, Stat, Standout, TagChip,
  fmtDuration, fmtDate, num,
} from './StatsKit'

export default function GalleryStatsModal({ galleryId, onClose }) {
  const navigate = useNavigate()
  const open = !!galleryId

  const { data: d, isLoading } = useQuery({
    queryKey: ['gallery-stats', galleryId],
    queryFn: () => galleriesApi.detailStats(galleryId).then(r => r.data),
    enabled: open,
    staleTime: 0,
  })

  const go = (path) => { onClose(); navigate(path) }

  return (
    <StatsModalShell open={open} onClose={onClose}>
      {(isLoading || !d) ? <LoadingBody /> : (
        <>
          {/* ── Hero ───────────────────────────────────────────────────── */}
          <div className="relative overflow-hidden rounded-[16px] mb-6"
               style={{ border: '0.5px solid rgba(127,119,221,0.35)',
                        boxShadow: '0 0 50px 8px rgba(127,119,221,0.13)' }}>
            {d.cover_thumb && (
              <img src={d.cover_thumb} alt="" aria-hidden
                   style={{ position: 'absolute', inset: 0, width: '100%', height: '100%',
                            objectFit: 'cover', opacity: 0.16, filter: 'blur(18px)' }} />
            )}
            <div className="relative flex items-start gap-5 p-6">
              {d.cover_thumb && (
                <img src={d.cover_thumb} alt=""
                     className="rounded-[12px] flex-shrink-0"
                     style={{ width: 128, height: 128, objectFit: 'cover',
                              border: '0.5px solid rgba(255,255,255,0.15)' }} />
              )}
              <div className="flex flex-col gap-3 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <Trophy size={16} style={{ color: '#FAC775' }} />
                  <span style={{ fontSize: 16, fontWeight: 700, textTransform: 'uppercase',
                                 letterSpacing: '0.12em', color: '#FAC775' }}>
                    {d.rank ? `#${d.rank} of ${num(d.total_galleries_ranked)} galleries` : 'Gallery'}
                  </span>
                </div>
                <h2 style={{ fontSize: 34, fontWeight: 800, color: 'rgba(255,255,255,0.96)', lineHeight: 1.1 }}>
                  {d.name}
                </h2>
                {d.creators?.length > 0 && (
                  <div className="flex items-center gap-2 flex-wrap">
                    {d.creators.map(c => (
                      <button key={c.id} onClick={() => go(`/creators/${c.id}`)}
                              className="px-2.5 py-1 rounded-full cursor-pointer transition-colors hover:bg-white/10"
                              style={{ fontSize: 16, color: '#CECBF6',
                                       background: 'rgba(127,119,221,0.15)',
                                       border: '0.5px solid rgba(127,119,221,0.3)' }}>
                        {c.name} <ArrowUpRight size={12} className="inline" />
                      </button>
                    ))}
                  </div>
                )}
                <div className="flex items-end gap-6 flex-wrap mt-1">
                  <div className="flex flex-col">
                    <span className="flex items-center gap-2" style={{ fontSize: 16, color: 'rgba(255,255,255,0.4)' }}>
                      <Clock size={15} /> Time spent here
                    </span>
                    <span style={{ fontSize: 30, fontWeight: 800, color: '#CECBF6', lineHeight: 1.1 }}>
                      {fmtDuration(d.view_seconds) || '—'}
                    </span>
                  </div>
                  <div className="flex flex-col">
                    <span className="flex items-center gap-2" style={{ fontSize: 16, color: 'rgba(255,255,255,0.4)' }}>
                      <Droplets size={15} /> Os
                    </span>
                    <span style={{ fontSize: 30, fontWeight: 800, color: '#ED93B1', lineHeight: 1.1 }}>
                      {num(d.cum_count)}
                    </span>
                  </div>
                  {d.edge_count > 0 && (
                    <div className="flex flex-col">
                      <span className="flex items-center gap-2" style={{ fontSize: 16, color: 'rgba(255,255,255,0.4)' }}>
                        <Waves size={15} /> Edges
                      </span>
                      <span style={{ fontSize: 30, fontWeight: 800, color: '#A89FE8', lineHeight: 1.1 }}>
                        {num(d.edge_count)}
                      </span>
                    </div>
                  )}
                </div>
                <div style={{ fontSize: 16, color: 'rgba(255,255,255,0.5)', lineHeight: 1.5, maxWidth: 620 }}>
                  Holds <b style={{ color: '#CECBF6' }}>{d.share_of_total_time}%</b> of all your viewing time
                  and <b style={{ color: '#ED93B1' }}>{d.share_of_total_cum}%</b> of your lifetime Os.
                </div>
              </div>
            </div>
          </div>

          <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(2, minmax(0,1fr))' }}>

            {/* ── Contents ─────────────────────────────────────────────── */}
            <Panel icon={Images} title="Contents" subtitle="What's in here" accent="#7F77DD">
              <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(3, minmax(0,1fr))' }}>
                <Stat label="Photos" value={num(d.photo_count)} />
                <Stat label="Videos" value={num(d.video_count)} />
                <Stat label="On disk" value={`${d.total_size_gb ?? 0} GB`} />
                <Stat label="Total views" value={num(d.total_views)}
                      sub={`${num(d.image_views)} media · ${num(d.gallery_views)} gallery`} />
                <Stat label="Video runtime"
                      value={d.video_count_known_len > 0 ? (fmtDuration(d.video_runtime_sec) || '—') : '—'}
                      sub={d.video_count > 0 && d.video_count_known_len < d.video_count
                        ? `length known for ${d.video_count_known_len}/${d.video_count}` : undefined} />
                <Stat label="Time on videos" value={fmtDuration(d.video_watch_seconds) || '—'} accent="#9F99E8" />
              </div>
            </Panel>

            {/* ── Intensity ────────────────────────────────────────────── */}
            <Panel icon={TrendingUp} title="Intensity" subtitle="How hard it's been used" accent="#ED93B1">
              <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(3, minmax(0,1fr))' }}>
                <Stat label="Os / hour" value={d.os_per_hour ?? 0} accent="#ED93B1" />
                <Stat label="Os / view" value={d.os_per_view ?? 0} accent="#ED93B1" />
                <Stat label="Views / item" value={d.views_per_photo ?? 0} />
                <Stat label="Share of your Os" value={`${d.share_of_total_cum ?? 0}%`} accent="#ED93B1" />
                <Stat label="Share of your time" value={`${d.share_of_total_time ?? 0}%`} accent="#CECBF6" />
                <Stat label="Sessions logged" value={num(d.session_count)} />
                {d.avg_dwell_seconds > 0 && (
                  <Stat label="Seconds per photo" value={`${d.avg_dwell_seconds}s`} accent="#9FE1CB" />
                )}
                {d.edge_count > 0 && (
                  <Stat label="Edges per O" value={d.edges_per_cum ? `${d.edges_per_cum}×` : '—'} accent="#A89FE8" />
                )}
                <Stat label="Hall of Fame score" value={num(d.hof_score)} accent="#FAC775"
                      sub={d.rank ? `#${d.rank} of ${num(d.total_galleries_ranked)}` : undefined} />
              </div>
              {d.points_to_first > 0 && d.leader_name && (
                <div className="rounded-[10px] px-4 py-3 mt-3"
                     style={{ background: 'rgba(250,199,117,0.07)', border: '0.5px solid rgba(250,199,117,0.22)' }}>
                  <div style={{ fontSize: 16, color: 'rgba(255,255,255,0.55)', lineHeight: 1.5 }}>
                    <b style={{ color: '#FAC775' }}>{num(d.points_to_first)} points</b> behind “{d.leader_name}”
                    {' '}— about <b style={{ color: '#FAC775' }}>{Math.ceil(d.points_to_first / 120)} more Os</b>.
                  </div>
                </div>
              )}
            </Panel>

            {/* ── Standouts ────────────────────────────────────────────── */}
            <Panel icon={Star} title="Standouts" subtitle="The ones that earned it" accent="#FAC775">
              <div className="flex flex-col gap-2">
                {d.most_gooned && (
                  <Standout label="Most-gooned" accent="#ED93B1"
                            thumb={`/api/images/${d.most_gooned.id}/thumb`}
                            title={d.most_gooned.filename}
                            meta={`${num(d.most_gooned.cum_count)} Os · ${num(d.most_gooned.view_count)} views`}
                            onClick={() => go(`/galleries/${d.id}?openImage=${d.most_gooned.id}`)} />
                )}
                {d.most_edged && (
                  <Standout label="Most-edged" accent="#A89FE8"
                            thumb={`/api/images/${d.most_edged.id}/thumb`}
                            title={d.most_edged.filename}
                            meta={`${num(d.most_edged.edge_count)} edges`}
                            onClick={() => go(`/galleries/${d.id}?openImage=${d.most_edged.id}`)} />
                )}
                {d.most_viewed && (
                  <Standout label="Most-viewed" accent="#7F77DD"
                            thumb={`/api/images/${d.most_viewed.id}/thumb`}
                            title={d.most_viewed.filename}
                            meta={`${num(d.most_viewed.view_count)} views`}
                            onClick={() => go(`/galleries/${d.id}?openImage=${d.most_viewed.id}`)} />
                )}
                {d.longest_watched && (
                  <Standout label="Longest watched" accent="#9F99E8"
                            thumb={`/api/images/${d.longest_watched.id}/thumb`}
                            title={d.longest_watched.filename}
                            meta={fmtDuration(d.longest_watched.view_seconds)}
                            onClick={() => go(`/galleries/${d.id}?openImage=${d.longest_watched.id}`)} />
                )}
                {!d.most_gooned && !d.most_viewed && (
                  <div style={{ fontSize: 16, color: 'rgba(255,255,255,0.25)' }}>Nothing stands out yet</div>
                )}
              </div>
            </Panel>

            {/* ── Curation & timeline ──────────────────────────────────── */}
            <Panel icon={Calendar} title="Curation & timeline" subtitle="How well kept, and since when" accent="#1D9E75">
              <div className="grid gap-3 mb-3" style={{ gridTemplateColumns: 'repeat(3, minmax(0,1fr))' }}>
                <Stat label="Avg photo rating"
                      value={d.avg_image_rating ? d.avg_image_rating : '—'}
                      sub={d.rated_count ? `${d.rated_count} rated` : 'none rated'}
                      accent="#EF9F27" />
                <Stat label="Gallery rating" value={d.rating ? d.rating : '—'} accent="#EF9F27" />
                <Stat label="Favourites" value={num(d.favorite_count)} />
                <Stat label="AI tagged" value={`${d.tagged_pct ?? 0}%`}
                      sub={`${num(d.ai_tagged_count)} files`} />
                <Stat label="Added" value={fmtDate(d.first_added_at || d.created_at)} />
                <Stat label="Last opened" value={fmtDate(d.last_viewed_at)} />
              </div>
              {d.top_tags?.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-2" style={{ fontSize: 16, color: 'rgba(255,255,255,0.35)' }}>
                    <TagIcon size={14} /> Most common tags
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {d.top_tags.map(t => (
                      <TagChip key={t.name} name={t.name} source={t.source} count={t.count} />
                    ))}
                  </div>
                </div>
              )}
            </Panel>
          </div>

          <button onClick={() => go(`/galleries/${d.id}`)}
                  className="w-full mt-4 py-3 rounded-[10px] cursor-pointer transition-colors hover:bg-white/10"
                  style={{ fontSize: 17, fontWeight: 600, color: '#CECBF6',
                           background: 'rgba(127,119,221,0.15)',
                           border: '0.5px solid rgba(127,119,221,0.35)' }}>
            Open gallery →
          </button>
        </>
      )}
    </StatsModalShell>
  )
}

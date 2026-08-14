/**
 * <MediaStatsModal /> — deep stats for a single photo or video.
 *
 * Ranks a file three ways, because "top 20 in the whole vault" and "the best
 * shot in its own set" are different kinds of good and both worth knowing.
 */
import React from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  TrendingUp, Trophy, Droplets, Waves, Clock, Eye, Tag as TagIcon,
  Images, Film, ArrowUpRight, Star, Info,
} from 'lucide-react'
import { imagesApi } from '../../lib/api'
import {
  StatsModalShell, LoadingBody, Panel, Stat, TagChip,
  fmtDuration, fmtDate, num,
} from './StatsKit'

export default function MediaStatsModal({ imageId, onClose }) {
  const navigate = useNavigate()
  const open = !!imageId

  const { data: d, isLoading } = useQuery({
    queryKey: ['image-stats', imageId],
    queryFn: () => imagesApi.stats(imageId).then(r => r.data),
    enabled: open,
    staleTime: 0,
  })

  const go = (path) => { onClose(); navigate(path) }

  return (
    <StatsModalShell open={open} onClose={onClose} maxWidth={980}>
      {(isLoading || !d) ? <LoadingBody /> : (
        <>
          {/* ── Hero ───────────────────────────────────────────────────── */}
          <div className="relative overflow-hidden rounded-[16px] mb-6"
               style={{ border: '0.5px solid color-mix(in srgb, var(--c-pink) 32%, transparent)',
                        boxShadow: '0 0 50px 8px color-mix(in srgb, var(--c-pink) 12%, transparent)' }}>
            <img src={`/api/images/${d.id}/thumb`} alt="" aria-hidden
                 style={{ position: 'absolute', inset: 0, width: '100%', height: '100%',
                          objectFit: 'cover', opacity: 0.15, filter: 'blur(20px)' }} />
            <div className="relative flex items-start gap-5 p-6">
              <button onClick={() => go(`/galleries/${d.gallery_id}?openImage=${d.id}`)}
                      className="flex-shrink-0 cursor-pointer rounded-[12px] overflow-hidden"
                      style={{ border: '0.5px solid rgba(255,255,255,0.15)' }}
                      title="Open in the viewer">
                <img src={`/api/images/${d.id}/thumb`} alt={d.filename}
                     style={{ width: 150, height: 150, objectFit: 'cover', display: 'block' }} />
              </button>
              <div className="flex flex-col gap-3 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <Trophy size={16} style={{ color: 'var(--c-amber-text)' }} />
                  <span style={{ fontSize: 16, fontWeight: 700, textTransform: 'uppercase',
                                 letterSpacing: '0.12em', color: 'var(--c-amber-text)' }}>
                    #{num(d.rank)} of {num(d.total_ranked)}
                  </span>
                  <span style={{ fontSize: 16, color: 'rgba(255,255,255,0.25)' }}>·</span>
                  <span className="flex items-center gap-1.5"
                        style={{ fontSize: 16, color: 'rgba(255,255,255,0.45)' }}>
                    {d.is_video ? <Film size={14} /> : <Images size={14} />}
                    {d.is_video ? 'Video' : 'Photo'}
                  </span>
                </div>
                <h2 className="break-all"
                    style={{ fontSize: 26, fontWeight: 800, color: 'rgba(255,255,255,0.96)', lineHeight: 1.15 }}>
                  {d.filename}
                </h2>
                <div className="flex items-center gap-2 flex-wrap">
                  {d.gallery && (
                    <button onClick={() => go(`/galleries/${d.gallery.id}`)}
                            className="px-2.5 py-1 rounded-full cursor-pointer transition-colors hover:bg-white/10"
                            style={{ fontSize: 16, color: 'var(--c-accent-text)', background: 'color-mix(in srgb, var(--c-accent) 15%, transparent)',
                                     border: '0.5px solid color-mix(in srgb, var(--c-accent) 30%, transparent)' }}>
                      {d.gallery.name} <ArrowUpRight size={12} className="inline" />
                    </button>
                  )}
                  {d.creators?.map(c => (
                    <button key={c.id} onClick={() => go(`/creators/${c.id}`)}
                            className="px-2.5 py-1 rounded-full cursor-pointer transition-colors hover:bg-white/10"
                            style={{ fontSize: 16, color: '#F4C0D1', background: 'color-mix(in srgb, var(--c-pink) 15%, transparent)',
                                     border: '0.5px solid color-mix(in srgb, var(--c-pink) 30%, transparent)' }}>
                      {c.name} <ArrowUpRight size={12} className="inline" />
                    </button>
                  ))}
                </div>
                <div className="flex items-end gap-6 flex-wrap mt-1">
                  <div className="flex flex-col">
                    <span className="flex items-center gap-2" style={{ fontSize: 16, color: 'rgba(255,255,255,0.4)' }}>
                      <Droplets size={15} /> Os
                    </span>
                    <span style={{ fontSize: 30, fontWeight: 800, color: 'var(--c-pink-text)', lineHeight: 1.1 }}>
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
                  <div className="flex flex-col">
                    <span className="flex items-center gap-2" style={{ fontSize: 16, color: 'rgba(255,255,255,0.4)' }}>
                      <Clock size={15} /> Watched
                    </span>
                    <span style={{ fontSize: 30, fontWeight: 800, color: 'var(--c-accent-text)', lineHeight: 1.1 }}>
                      {fmtDuration(d.view_seconds) || '—'}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(2, minmax(0,1fr))' }}>

            <Panel icon={TrendingUp} title="How it earned its place" accent="var(--c-pink-text)">
              <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(2, minmax(0,1fr))' }}>
                <Stat label="Views" value={num(d.view_count)} />
                <Stat label="Os per view" value={d.os_per_view ?? 0} accent="var(--c-pink-text)"
                      sub={d.os_per_view >= 0.5 ? 'exceptional' : undefined} />
                {d.avg_dwell_seconds > 0 && (
                  <Stat label="Seconds per view" value={`${d.avg_dwell_seconds}s`} accent="var(--c-green-text)" />
                )}
                {d.edge_count > 0 && (
                  <Stat label="Edges per O" value={d.edges_per_cum ? `${d.edges_per_cum}×` : '—'} accent="#A89FE8" />
                )}
                {d.watch_throughs > 0 && (
                  <Stat label="Watched through" value={`${d.watch_throughs}×`} accent="var(--c-accent-text)"
                        sub="its full length" />
                )}
                <Stat label="Hall of Fame score" value={num(d.hof_score)} accent="var(--c-amber-text)" />
              </div>
            </Panel>

            <Panel icon={Trophy} title="Where it ranks" subtitle="Three different kinds of good" accent="var(--c-amber-text)">
              <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(2, minmax(0,1fr))' }}>
                <Stat label="In the whole vault" value={`#${num(d.rank)}`} accent="var(--c-amber-text)"
                      sub={`of ${num(d.total_ranked)} ranked`} big />
                {d.rank_in_gallery && (
                  <Stat label="In its gallery" value={`#${num(d.rank_in_gallery)}`} accent="var(--c-accent-text)"
                        sub={`of ${num(d.gallery_siblings)}`} big />
                )}
                <Stat label="Share of your Os" value={`${d.share_of_total_cum ?? 0}%`} accent="var(--c-pink-text)" />
                {d.share_of_gallery_cum != null && (
                  <Stat label="Share of gallery Os" value={`${d.share_of_gallery_cum}%`} accent="var(--c-pink-text)" />
                )}
                {d.share_of_gallery_time != null && (
                  <Stat label="Share of gallery time" value={`${d.share_of_gallery_time}%`} accent="var(--c-accent-text)" />
                )}
              </div>
            </Panel>

            <Panel icon={Info} title="The file itself" accent="var(--c-accent)">
              <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(2, minmax(0,1fr))' }}>
                <Stat label="Dimensions"
                      value={d.width && d.height ? `${d.width}×${d.height}` : '—'}
                      sub={d.megapixels > 0 ? `${d.megapixels} MP` : undefined} />
                <Stat label="Size" value={d.file_size_mb ? `${d.file_size_mb} MB` : '—'} />
                {d.is_video && (
                  <Stat label="Length" value={fmtDuration(d.duration) || '—'} />
                )}
                {d.is_video && d.funscript_path && (
                  <Stat label="Funscript" value="Yes" accent="var(--c-green)" sub="syncs to device" />
                )}
                <Stat label="Rating" value={d.rating ? `${d.rating}/10` : '—'} accent="var(--c-amber-text)" />
                <Stat label="Added" value={fmtDate(d.created_at)} />
                <Stat label="Last opened" value={fmtDate(d.last_viewed_at)} />
              </div>
            </Panel>

            <Panel icon={TagIcon} title="Tags"
                   subtitle={d.tags?.length ? `${d.tags.length} on this file — purple is AI` : 'None yet'}
                   accent="var(--c-green)">
              {d.tags?.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {d.tags.map(t => (
                    <TagChip key={t.name} name={t.name} source={t.source} confidence={t.confidence} />
                  ))}
                </div>
              ) : (
                <div style={{ fontSize: 16, color: 'rgba(255,255,255,0.25)' }}>
                  Nothing tagged here yet
                </div>
              )}
              {d.creators_inherited && d.creators?.length > 0 && (
                <div className="mt-3" style={{ fontSize: 15, color: 'rgba(255,255,255,0.3)' }}>
                  Creator inherited from the gallery — no per-file assignment.
                </div>
              )}
            </Panel>
          </div>

          <button onClick={() => go(`/galleries/${d.gallery_id}?openImage=${d.id}`)}
                  className="w-full mt-4 py-3 rounded-[10px] cursor-pointer transition-colors hover:bg-white/10"
                  style={{ fontSize: 17, fontWeight: 600, color: '#F4C0D1',
                           background: 'color-mix(in srgb, var(--c-pink) 15%, transparent)',
                           border: '0.5px solid color-mix(in srgb, var(--c-pink) 35%, transparent)' }}>
            Open in the viewer →
          </button>
        </>
      )}
    </StatsModalShell>
  )
}

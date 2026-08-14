import React, { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import {
  X, Crown, Clock, Droplets, Eye, Images, Film, Camera, Star, Heart,
  Tag as TagIcon, Sparkles, TrendingUp, Calendar, HardDrive, Layers,
  MessageCircle, Gift, ArrowUpRight, Waves,
} from 'lucide-react'
import { creatorsApi } from '../lib/api'
import BondHearts, { BOND_TIERS } from './BondHearts'
import VaultCard from './VaultCard'

// ── Rarity accent (mirrors HallOfFame) ────────────────────────────────────────
const RARITY_COLORS = {
  common: '#888780', uncommon: '#1D9E75', rare: '#378ADD',
  epic: '#7F77DD', legendary: '#BA7517', celestial: '#E0B0FF',
}

// ── Formatters ────────────────────────────────────────────────────────────────
function fmtDuration(secs) {
  if (!secs || secs < 60) return `${Math.max(0, secs || 0)}s`
  const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60)
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`
  return `${m}m`
}
function fmtDate(iso) {
  if (!iso) return '—'
  try { return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) }
  catch { return '—' }
}
function daysAgo(iso) {
  if (!iso) return null
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
  if (d <= 0) return 'today'
  if (d === 1) return 'yesterday'
  return `${d} days ago`
}
const num = (n) => (n ?? 0).toLocaleString()

// ── Building blocks ───────────────────────────────────────────────────────────
function Panel({ icon: Icon, title, subtitle, accent = 'var(--c-accent)', children }) {
  return (
    <section className="rounded-[14px] p-6"
             style={{ background: 'rgba(255,255,255,0.025)', border: '0.5px solid rgba(255,255,255,0.08)' }}>
      <div className="flex items-center gap-3 mb-5">
        <div className="flex items-center justify-center w-9 h-9 rounded-[9px] flex-shrink-0"
             style={{ background: `${accent}1E`, border: `0.5px solid ${accent}55` }}>
          <Icon size={18} style={{ color: accent }} />
        </div>
        <div>
          <div className="text-[19px] font-bold" style={{ color: 'rgba(255,255,255,0.92)' }}>{title}</div>
          {subtitle && <div className="text-[16px]" style={{ color: 'rgba(255,255,255,0.35)' }}>{subtitle}</div>}
        </div>
      </div>
      {children}
    </section>
  )
}

function Stat({ label, value, sub, accent = 'rgba(255,255,255,0.92)', big = false }) {
  return (
    <div className="rounded-[10px] px-4 py-3 flex flex-col gap-0.5"
         style={{ background: 'rgba(255,255,255,0.03)', border: '0.5px solid rgba(255,255,255,0.06)' }}>
      <div style={{ fontSize: 16, color: 'rgba(255,255,255,0.4)' }}>{label}</div>
      <div style={{ fontSize: big ? 30 : 24, fontWeight: 800, color: accent, lineHeight: 1.1, letterSpacing: '-0.01em' }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: 16, color: 'rgba(255,255,255,0.3)' }}>{sub}</div>}
    </div>
  )
}

// Tiny SVG bar sparkline over a monthly series
function Sparkline({ points = [], accessor, accent = 'var(--c-accent)', height = 60, labelFmt }) {
  if (!points.length) {
    return <div style={{ fontSize: 16, color: 'rgba(255,255,255,0.25)' }}>No history yet</div>
  }
  const vals = points.map(accessor)
  const max = Math.max(...vals, 1)
  const gap = 4
  const barW = points.length > 0 ? `calc((100% - ${(points.length - 1) * gap}px) / ${points.length})` : '100%'
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-end" style={{ height, gap }}>
        {points.map((p, i) => {
          const v = accessor(p)
          const h = Math.max(3, Math.round((v / max) * height))
          return (
            <div key={i} title={`${p.month}: ${v}`}
                 style={{ width: barW, height: h, borderRadius: 3,
                          background: `linear-gradient(to top, ${accent}, ${accent}88)`,
                          transition: 'height 0.4s ease' }} />
          )
        })}
      </div>
      <div className="flex justify-between" style={{ fontSize: 16, color: 'rgba(255,255,255,0.3)' }}>
        <span>{points[0].month}</span>
        {points.length > 1 && <span>{points[points.length - 1].month}</span>}
      </div>
      {labelFmt && <div style={{ fontSize: 16, color: 'rgba(255,255,255,0.4)' }}>{labelFmt(vals)}</div>}
    </div>
  )
}

// Proportional segmented bar (orientation split)
function SplitBar({ segments }) {
  const total = segments.reduce((s, x) => s + x.value, 0) || 1
  return (
    <div className="flex flex-col gap-2">
      <div className="flex w-full overflow-hidden rounded-full" style={{ height: 12 }}>
        {segments.map((s, i) => (
          <div key={i} style={{ width: `${(s.value / total) * 100}%`, background: s.color }}
               title={`${s.label}: ${s.value}`} />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {segments.map((s, i) => (
          <span key={i} className="flex items-center gap-1.5" style={{ fontSize: 16, color: 'rgba(255,255,255,0.5)' }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: s.color, display: 'inline-block' }} />
            {s.label} · {num(s.value)}
          </span>
        ))}
      </div>
    </div>
  )
}

function TagChip({ tag }) {
  const ai = tag.source === 'ai'
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full"
          style={{
            fontSize: 16,
            background: ai ? 'color-mix(in srgb, var(--c-accent) 14%, transparent)' : 'rgba(255,255,255,0.06)',
            border: `0.5px solid ${ai ? 'color-mix(in srgb, var(--c-accent) 40%, transparent)' : 'rgba(255,255,255,0.12)'}`,
            color: ai ? '#C7C2F5' : 'rgba(255,255,255,0.85)',
          }}>
      {tag.name}
      <span style={{ opacity: 0.55 }}>{num(tag.count)}</span>
    </span>
  )
}

// Small standout-media card (image or gallery cover)
function Standout({ label, thumb, title, meta, accent, onClick }) {
  return (
    <button onClick={onClick}
            className="group flex items-center gap-3 rounded-[10px] p-2.5 text-left w-full cursor-pointer transition-colors"
            style={{ background: 'rgba(255,255,255,0.03)', border: '0.5px solid rgba(255,255,255,0.07)' }}>
      <div className="w-16 h-16 rounded-[8px] overflow-hidden flex-shrink-0" style={{ background: '#111' }}>
        {thumb
          ? <img src={thumb} alt="" className="w-full h-full object-cover" style={{ objectPosition: 'top center' }}
                 onError={e => { e.target.style.display = 'none' }} />
          : <div className="w-full h-full flex items-center justify-center opacity-20"><Images size={22} /></div>}
      </div>
      <div className="min-w-0 flex-1">
        <div style={{ fontSize: 16, color: accent, fontWeight: 600 }}>{label}</div>
        <div className="truncate" style={{ fontSize: 16, color: 'rgba(255,255,255,0.75)' }}>{title}</div>
        <div style={{ fontSize: 16, color: 'rgba(255,255,255,0.35)' }}>{meta}</div>
      </div>
      <ArrowUpRight size={16} className="opacity-0 group-hover:opacity-60 transition-opacity" style={{ color: '#fff' }} />
    </button>
  )
}

// ── Main body (given loaded data) ─────────────────────────────────────────────
// ── Honours ───────────────────────────────────────────────────────────────────
// Crowns ladder by how long a window she held, not by rank — so the colours
// follow the card tier each one mints at.
const CROWN_META = {
  day:   { label: 'Daily',   plural: 'daily crowns',   color: 'var(--c-accent)', ring: 'color-mix(in srgb, var(--c-accent) 40%, transparent)' },
  week:  { label: 'Weekly',  plural: 'weekly crowns',  color: '#FFD700', ring: 'rgba(255,215,0,0.4)' },
  month: { label: 'Monthly', plural: 'monthly crowns', color: '#E0B0FF', ring: 'rgba(224,176,255,0.42)' },
}

function crownDate(c) {
  if (c.period_type === 'month') {
    const [y, m] = c.period_key.split('-')
    return new Date(y, Number(m) - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
  }
  if (c.period_type === 'week') return `Week ${c.period_key.split('-W')[1]}, ${c.period_key.split('-')[0]}`
  return new Date(c.period_key).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
}

function CrownsPanel({ crowns }) {
  const { total, counts, crowns: list } = crowns
  return (
    <div className="rounded-[14px] p-6 mb-6"
         style={{ background: 'color-mix(in srgb, var(--c-amber) 5%, transparent)', border: '0.5px solid color-mix(in srgb, var(--c-amber) 28%, transparent)' }}>
      <div className="flex items-center gap-3 mb-5">
        <div className="flex items-center justify-center w-9 h-9 rounded-[10px]"
             style={{ background: 'color-mix(in srgb, var(--c-amber) 15%, transparent)', border: '0.5px solid color-mix(in srgb, var(--c-amber) 40%, transparent)' }}>
          <Crown size={17} style={{ color: 'var(--c-amber-text)' }} />
        </div>
        <div>
          <div className="text-[20px] font-bold text-[rgba(255,255,255,0.92)]">Honours</div>
          <div style={{ fontSize: 16, color: 'rgba(255,255,255,0.35)' }}>
            Hall of Fame periods she has topped — each one minted a card that can never be won again
          </div>
        </div>
      </div>

      <div className="flex items-center gap-8 flex-wrap mb-5">
        <div>
          <div style={{ fontSize: 46, fontWeight: 800, color: 'var(--c-amber-text)', lineHeight: 1 }}>{total}</div>
          <div style={{ fontSize: 16, color: 'rgba(255,255,255,0.4)' }}>
            crown{total === 1 ? '' : 's'} total
          </div>
        </div>
        {Object.entries(CROWN_META).map(([k, meta]) => (
          (counts?.[k] ?? 0) > 0 && (
            <div key={k} className="px-4 py-2.5 rounded-[12px]"
                 style={{ background: `${meta.color}14`, border: `0.5px solid ${meta.ring}` }}>
              <div style={{ fontSize: 26, fontWeight: 800, color: meta.color, lineHeight: 1 }}>
                {counts[k]}
              </div>
              <div style={{ fontSize: 16, color: 'rgba(255,255,255,0.45)' }}>{meta.label}</div>
            </div>
          )
        ))}
      </div>

      <div className="flex flex-col gap-1.5" style={{ maxHeight: 236, overflowY: 'auto' }}>
        {list.map(c => {
          const meta = CROWN_META[c.period_type] ?? CROWN_META.day
          return (
            <div key={c.id} className="flex items-center gap-3 px-3 py-2 rounded-[9px]"
                 style={{ background: 'rgba(255,255,255,0.025)' }}>
              <Crown size={15} style={{ color: meta.color, flexShrink: 0 }} />
              <span style={{ fontSize: 16, fontWeight: 700, color: meta.color, minWidth: 66 }}>
                {meta.label}
              </span>
              <span style={{ fontSize: 16, color: 'rgba(255,255,255,0.78)', flex: 1 }}>
                {crownDate(c)}
              </span>
              {c.field_size > 1 && (
                <span style={{ fontSize: 16, color: 'rgba(255,255,255,0.35)' }}
                      title="How many creators she beat that period">
                  beat {c.field_size - 1}
                </span>
              )}
              <span style={{ fontSize: 16, color: 'rgba(255,255,255,0.25)', minWidth: 64, textAlign: 'right' }}>
                {num(c.score)}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function StatsBody({ d, onNavigate, onClose }) {
  const accent = RARITY_COLORS[d.card_rarity] || RARITY_COLORS.common
  const avatarUrl = d.avatar_path ? `/api/creators/${d.id}/avatar` : null
  const go = (path) => { onClose(); onNavigate(path) }

  const orientation = d.orientation || {}
  const totalTagApps = (d.ai_tag_count || 0) + (d.manual_tag_count || 0)
  const aiPct = totalTagApps ? Math.round(100 * (d.ai_tag_count || 0) / totalTagApps) : 0

  return (
    <>
      {/* ── HERO (narrative) ─────────────────────────────────────────────────── */}
      <div className="relative overflow-hidden rounded-[16px] mb-6"
           style={{ border: `0.5px solid ${accent}55`, boxShadow: `0 0 50px 8px ${accent}22` }}>
        {avatarUrl && (
          <img src={avatarUrl} alt="" aria-hidden
               style={{ position: 'absolute', inset: 0, width: '100%', height: '100%',
                        objectFit: 'cover', objectPosition: 'top center',
                        filter: 'blur(26px)', transform: 'scale(1.15)', opacity: 0.4 }} />
        )}
        <div style={{ position: 'absolute', inset: 0,
                      background: 'linear-gradient(to right, rgba(14,14,14,0.94) 0%, rgba(14,14,14,0.7) 55%, rgba(14,14,14,0.35) 100%)' }} />
        <div className="relative flex items-center gap-7 p-7">
          {/* Portrait */}
          <div className="flex-shrink-0 rounded-[13px] overflow-hidden"
               style={{ width: 168, height: 224, border: `1.5px solid ${accent}99`,
                        boxShadow: `0 0 26px 5px ${accent}44`, background: '#111' }}>
            {avatarUrl
              ? <img src={avatarUrl} alt={d.name} className="w-full h-full object-cover" style={{ objectPosition: 'top center' }} />
              : <div className="w-full h-full flex items-center justify-center"
                     style={{ fontSize: 56, fontWeight: 700, color: accent, opacity: 0.6 }}>
                  {(d.name || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
                </div>}
          </div>

          {/* Narrative block */}
          <div className="flex flex-col gap-3 min-w-0">
            <div className="flex items-center gap-2">
              <Crown size={16} style={{ color: 'var(--c-amber-text)' }} />
              <span style={{ fontSize: 16, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--c-amber-text)' }}>
                {d.rank ? `#${d.rank} of ${num(d.total_creators)} creators` : 'Creator'}
              </span>
            </div>
            <h2 style={{ fontSize: 40, fontWeight: 800, color: 'rgba(255,255,255,0.96)', lineHeight: 1.05 }}>
              <span style={{ color: 'rgba(255,255,255,0.5)', fontWeight: 600 }}>You &amp; </span>{d.name}
            </h2>

            {/* Marquee — time spent */}
            <div className="flex items-end gap-6 flex-wrap">
              <div className="flex flex-col">
                <span className="flex items-center gap-2" style={{ fontSize: 16, color: 'rgba(255,255,255,0.4)' }}>
                  <Clock size={15} /> Time spent together
                </span>
                <span style={{ fontSize: 34, fontWeight: 800, color: 'var(--c-accent-text)', lineHeight: 1.1 }}>
                  {fmtDuration(d.total_view_seconds)}
                </span>
              </div>
              <div className="flex flex-col">
                <span className="flex items-center gap-2" style={{ fontSize: 16, color: 'rgba(255,255,255,0.4)' }}>
                  <Droplets size={15} /> Lifetime Os
                </span>
                <span style={{ fontSize: 34, fontWeight: 800, color: 'var(--c-pink-text)', lineHeight: 1.1 }}>
                  {num(d.cum_count)}
                </span>
              </div>
              {d.edge_count > 0 && (
                <div className="flex flex-col">
                  <span className="flex items-center gap-2" style={{ fontSize: 16, color: 'rgba(255,255,255,0.4)' }}>
                    <Waves size={15} /> Edges
                  </span>
                  <span style={{ fontSize: 34, fontWeight: 800, color: '#A89FE8', lineHeight: 1.1 }}>
                    {num(d.edge_count)}
                  </span>
                </div>
              )}
            </div>

            <div style={{ fontSize: 16, color: 'rgba(255,255,255,0.55)', maxWidth: 640, lineHeight: 1.5 }}>
              In your collection for <b style={{ color: 'rgba(255,255,255,0.85)' }}>{num(d.days_in_collection)} days</b> (since {fmtDate(d.first_media_at)}).
              She holds <b style={{ color: 'var(--c-accent-text)' }}>{d.share_of_total_time}%</b> of all your viewing time
              and <b style={{ color: 'var(--c-pink-text)' }}>{d.share_of_total_cum}%</b> of your lifetime Os
              {d.edge_count > 0 && (
                <> — plus <b style={{ color: '#A89FE8' }}>{d.share_of_total_edges}%</b> of every edge you've held</>
              )}.
            </div>

            {!d.bond_excluded && (
              <div className="mt-1">
                <BondHearts level={d.bond_level ?? 0} bondScore={d.bond_score ?? 0} size="lg" showProgress />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Honours sit above the panel grid and span it — a crown is the loudest
          fact about a creator, and burying it in a column would undersell it. */}
      {(d.crowns?.total ?? 0) > 0 && <CrownsPanel crowns={d.crowns} />}

      {/* ── PANEL GRID ───────────────────────────────────────────────────────── */}
      <div className="grid gap-6" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>

        {/* Footprint */}
        <Panel icon={Images} title="The Footprint" accent="var(--c-accent)"
               subtitle="Everything of hers you've collected">
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(3, minmax(0,1fr))' }}>
            <Stat label="Galleries" value={num(d.gallery_count)} />
            <Stat label="Photos" value={num(d.photo_count)} />
            <Stat label="Videos" value={num(d.video_count)} />
            <Stat label="Total views" value={num(d.total_views)}
                  sub={`${num(d.image_views)} media · ${num(d.gallery_views)} gallery`} />
            <Stat label="On disk" value={`${d.total_size_gb ?? 0} GB`} />
            {/* Time actually spent watching — what people read "video runtime"
                as meaning, and unlike runtime it's accurate today. */}
            <Stat label="Time on videos" value={fmtDuration(d.video_watch_seconds) || '—'} accent="var(--c-accent-text)" />
            {/* Runtime is the combined length of her video files. It's only
                known for videos scanned since the duration probe existed, so
                say so rather than presenting a fraction as the total. */}
            <Stat
              label="Video runtime"
              value={d.video_count_known_len > 0 ? fmtDuration(d.total_runtime_sec) : '—'}
              sub={
                d.video_count_total > 0 && d.video_count_known_len < d.video_count_total
                  ? `length known for ${d.video_count_known_len}/${d.video_count_total}`
                  : undefined
              }
            />
          </div>
        </Panel>

        {/* Intensity */}
        <Panel icon={TrendingUp} title="Intensity" accent="var(--c-pink-text)"
               subtitle="How hard she's earned her spot">
          <div className="grid gap-3 mb-4" style={{ gridTemplateColumns: 'repeat(3, minmax(0,1fr))' }}>
            <Stat label="Os / hour" value={d.os_per_hour ?? 0} accent="var(--c-pink-text)" />
            <Stat label="Os / gallery" value={d.os_per_gallery ?? 0} accent="var(--c-pink-text)" />
            <Stat label="Views / gallery" value={d.views_per_gallery ?? 0} />
            <Stat label="Share of your Os" value={`${d.share_of_total_cum ?? 0}%`} accent="var(--c-pink-text)" />
            <Stat label="Share of your time" value={`${d.share_of_total_time ?? 0}%`} accent="var(--c-accent-text)" />
            <Stat label="Sessions logged" value={num(d.session_count)} />
            {d.edge_count > 0 && <>
              <Stat label="Edges / hour" value={d.edges_per_hour ?? 0} accent="#A89FE8" />
              <Stat label="Edges per O" value={d.edges_per_cum ? `${d.edges_per_cum}×` : '—'} accent="#A89FE8" />
              <Stat label="Share of your edges" value={`${d.share_of_total_edges ?? 0}%`} accent="#A89FE8" />
            </>}
            {d.avg_dwell_seconds > 0 && <>
              <Stat label="Seconds per photo" value={`${d.avg_dwell_seconds}s`} accent="var(--c-green-text)"
                    sub={d.median_dwell ? `you average ${d.median_dwell}s` : undefined} />
              <Stat label="Attention multiplier" value={`×${d.engagement_factor ?? 1}`} accent="var(--c-green-text)"
                    sub="applied to her ranking" />
            </>}
            <Stat label="Hall of Fame score" value={num(d.hof_score)} accent="var(--c-amber-text)"
                  sub={`#${d.rank ?? '—'} of ${num(d.total_creators)}`} />
          </div>

          {/* What it would take to reach #1 — the league-table question */}
          {d.points_to_first > 0 && d.leader_name && (
            <div className="rounded-[10px] px-4 py-3 mb-3"
                 style={{ background: 'color-mix(in srgb, var(--c-amber) 7%, transparent)', border: '0.5px solid color-mix(in srgb, var(--c-amber) 22%, transparent)' }}>
              <div style={{ fontSize: 16, color: 'rgba(255,255,255,0.55)', lineHeight: 1.5 }}>
                {/* Her attention multiplier scales everything she earns, so the
                    raw gap has to be divided by it before converting to Os or
                    hours — otherwise this overstates the work by ~50%. */}
                <b style={{ color: 'var(--c-amber-text)' }}>{num(d.points_to_first)} points</b> behind {d.leader_name}. That's
                roughly <b style={{ color: 'var(--c-amber-text)' }}>{Math.ceil(d.points_to_first / (120 * (d.engagement_factor || 1)))} more Os</b>,
                or <b style={{ color: 'var(--c-amber-text)' }}>{fmtDuration(Math.ceil(d.points_to_first / (d.engagement_factor || 1)))}</b> more
                time spent with her.
              </div>
            </div>
          )}
          <div className="flex flex-col gap-2">
            {d.most_gooned_image && (
              <Standout label="Most-gooned shot" accent="var(--c-pink-text)"
                        thumb={`/api/images/${d.most_gooned_image.id}/thumb`}
                        title={d.most_gooned_image.filename}
                        meta={`${num(d.most_gooned_image.cum_count)} Os · ${num(d.most_gooned_image.view_count)} views`}
                        onClick={() => go(`/galleries/${d.most_gooned_image.gallery_id}?openImage=${d.most_gooned_image.id}`)} />
            )}
            {d.most_edged_image && (
              <Standout label="Most-edged shot" accent="#A89FE8"
                        thumb={`/api/images/${d.most_edged_image.id}/thumb`}
                        title={d.most_edged_image.filename}
                        meta={`${num(d.most_edged_image.edge_count)} edges · ${num(d.most_edged_image.view_count)} views`}
                        onClick={() => go(`/galleries/${d.most_edged_image.gallery_id}?openImage=${d.most_edged_image.id}`)} />
            )}
            {d.most_viewed_gallery && (
              <Standout label="Most-visited gallery" accent="var(--c-accent)"
                        thumb={d.most_viewed_gallery.cover_thumb}
                        title={d.most_viewed_gallery.name}
                        meta={`${num(d.most_viewed_gallery.view_count)} views`}
                        onClick={() => go(`/galleries/${d.most_viewed_gallery.id}`)} />
            )}
          </div>
        </Panel>

        {/* Quality & Curation */}
        <Panel icon={Star} title="Quality & Curation" accent="var(--c-amber-text)"
               subtitle="Ratings, favorites & how well she's catalogued">
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(3, minmax(0,1fr))' }}>
            <Stat label="Avg photo rating" value={d.avg_image_rating ? `${d.avg_image_rating}` : '—'} sub="out of 10" accent="var(--c-amber-text)" />
            <Stat label="Avg gallery rating" value={d.avg_gallery_rating ? `${d.avg_gallery_rating}` : '—'} sub="out of 10" accent="var(--c-amber-text)" />
            <Stat label="Favorites" value={num(d.favorite_image_count)} />
            <Stat label="Rated" value={`${d.rated_pct ?? 0}%`} sub={`${num(d.rated_image_count)} photos`} />
            <Stat label="Tagged" value={`${d.tagged_pct ?? 0}%`} sub={`${num(d.tagged_image_count)} photos`} />
            <Stat label="Rarity" value={(d.card_rarity || 'common')} sub={`card lvl ${d.card_level ?? 1}`} accent={accent} />
          </div>
        </Panel>

        {/* Timeline */}
        <Panel icon={Calendar} title="Timeline" accent="var(--c-green-text)"
               subtitle="When she entered your world & when you visit">
          <div className="grid gap-5" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <div>
              <div className="mb-2 flex items-center gap-1.5" style={{ fontSize: 16, color: 'rgba(255,255,255,0.5)' }}>
                <Images size={14} /> Media added / month
              </div>
              <Sparkline points={d.acquisition_timeline} accessor={p => p.count} accent="var(--c-accent)" />
            </div>
            <div>
              <div className="mb-2 flex items-center gap-1.5" style={{ fontSize: 16, color: 'rgba(255,255,255,0.5)' }}>
                <Clock size={14} /> Sessions / month
              </div>
              <Sparkline points={d.activity_timeline} accessor={p => p.sessions} accent="var(--c-green-text)" />
            </div>
          </div>
          <div className="grid gap-3 mt-5" style={{ gridTemplateColumns: 'repeat(2, minmax(0,1fr))' }}>
            <Stat label="In collection since" value={fmtDate(d.first_media_at)} sub={`${num(d.days_in_collection)} days ago`} />
            <Stat label="Last seen" value={daysAgo(d.last_viewed_at) || '—'} sub={fmtDate(d.last_viewed_at)} />
          </div>
        </Panel>

        {/* Taste */}
        <Panel icon={TagIcon} title="Taste Profile" accent="#C7C2F5"
               subtitle="Her signature look, by your tags">
          {(d.top_tags?.length ?? 0) > 0 ? (
            <>
              <div className="flex flex-wrap gap-2 mb-5">
                {d.top_tags.slice(0, 16).map(t => <TagChip key={t.name} tag={t} />)}
              </div>
              <div className="mb-4" style={{ fontSize: 16, color: 'rgba(255,255,255,0.4)' }}>
                {aiPct}% AI-tagged · {100 - aiPct}% by hand
              </div>
            </>
          ) : (
            <div className="mb-4" style={{ fontSize: 16, color: 'rgba(255,255,255,0.3)' }}>No tags yet</div>
          )}
          <div className="mb-2 flex items-center gap-1.5" style={{ fontSize: 16, color: 'rgba(255,255,255,0.5)' }}>
            <Camera size={14} /> Orientation
          </div>
          <SplitBar segments={[
            { label: 'Portrait', value: orientation.portrait || 0, color: 'var(--c-accent)' },
            { label: 'Landscape', value: orientation.landscape || 0, color: 'var(--c-green-text)' },
            { label: 'Square', value: orientation.square || 0, color: 'var(--c-amber-text)' },
          ]} />
        </Panel>

        {/* Bond */}
        <Panel icon={Heart} title="Your Bond" accent="#FF2D75"
               subtitle="The relationship you've built">
          {d.bond_excluded ? (
            <div style={{ fontSize: 16, color: 'rgba(255,255,255,0.3)' }}>Bond tracking doesn't apply to this creator.</div>
          ) : (
            <>
              <div className="mb-4">
                <BondHearts level={d.bond_level ?? 0} bondScore={d.bond_score ?? 0} size="lg" showProgress />
              </div>
              <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(2, minmax(0,1fr))' }}>
                <Stat label="Bond tier" value={BOND_TIERS[d.bond_level] || 'None'} sub={`${num(Math.round(d.bond_score))} pts`} accent="#FF2D75" />
                <Stat label="Hearts gifted" value={num(d.bond_gifts)} />
                <Stat label="Personality" value={(d.personality_type || 'bold')} />
                <Stat label="Messages exchanged" value={num(d.messages_exchanged)} />
              </div>
            </>
          )}
        </Panel>

        {/* Cards — full width */}
        <div style={{ gridColumn: '1 / -1' }}>
          <Panel icon={Layers} title="Trading Cards" accent="#378ADD"
                 subtitle="What she's worth in your deck">
            {(d.cards?.owned_count ?? 0) > 0 || (d.cards?.showcase_slots_filled ?? 0) > 0 ? (
              <>
                <div className="grid gap-3 mb-5" style={{ gridTemplateColumns: 'repeat(5, minmax(0,1fr))' }}>
                  <Stat label="Cards owned" value={num(d.cards.owned_count)} accent="#378ADD" />
                  <Stat label="Variants" value={num(d.cards.variant_count)} />
                  <Stat label="Showcase" value={`${d.cards.showcase_slots_filled}/5`}
                        sub={d.cards.showcase_mastery ? 'Mastered ✦' : 'slots filled'}
                        accent={d.cards.showcase_mastery ? 'var(--c-amber-text)' : undefined} />
                  <Stat label="Total CXP" value={num(d.cards.total_cxp)} />
                  <Stat label="Rarest card"
                        value={d.cards.rarest ? `${d.cards.rarest.rarity}${d.cards.rarest.foil ? ' ✦' : ''}` : '—'}
                        sub={d.cards.rarest ? d.cards.rarest.type : undefined}
                        accent={d.cards.rarest ? (RARITY_COLORS[d.cards.rarest.rarity] || '#378ADD') : undefined} />
                </div>
                {(d.cards.previews?.length ?? 0) > 0 && (
                  <div className="flex flex-wrap gap-4 justify-center">
                    {d.cards.previews.map(card => (
                      <VaultCard key={card.inventory_id ?? card.id} card={card} width={168}
                                 onClick={() => go('/collection')} />
                    ))}
                  </div>
                )}
              </>
            ) : (
              <div style={{ fontSize: 16, color: 'rgba(255,255,255,0.3)' }}>
                No cards featuring her yet — open packs to start her collection.
              </div>
            )}
          </Panel>
        </div>

      </div>
    </>
  )
}

// ── Modal shell ───────────────────────────────────────────────────────────────
export default function CreatorStatsModal({ creatorId, onClose }) {
  const navigate = useNavigate()
  const { data, isLoading, isError } = useQuery({
    queryKey: ['creator-stats', creatorId],
    queryFn: () => creatorsApi.stats(creatorId).then(r => r.data),
    enabled: !!creatorId,
    staleTime: 30000,
  })

  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  return createPortal(
    <AnimatePresence>
      {creatorId && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          onClick={onClose}
          className="fixed inset-0 z-[9998] flex items-start justify-center p-4 sm:p-8 overflow-y-auto"
          style={{ background: 'rgba(0,0,0,0.78)', backdropFilter: 'blur(6px)' }}>
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.99 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            onClick={e => e.stopPropagation()}
            className="relative w-full rounded-[18px] my-auto"
            style={{ maxWidth: 1120, background: '#111112',
                     border: '0.5px solid rgba(255,255,255,0.1)',
                     boxShadow: '0 30px 80px rgba(0,0,0,0.7)' }}>

            {/* Close */}
            <button onClick={onClose}
                    className="absolute top-4 right-4 z-10 w-9 h-9 rounded-full flex items-center justify-center cursor-pointer transition-colors hover:bg-white/10"
                    style={{ background: 'rgba(0,0,0,0.5)', border: '0.5px solid rgba(255,255,255,0.15)', color: 'rgba(255,255,255,0.75)' }}>
              <X size={18} />
            </button>

            <div className="p-6 sm:p-8">
              {isLoading && (
                <div className="flex flex-col items-center justify-center gap-3 py-24">
                  <Sparkles size={30} className="animate-pulse" style={{ color: 'var(--c-accent)' }} />
                  <span style={{ fontSize: 16, color: 'rgba(255,255,255,0.4)' }}>Crunching the numbers…</span>
                </div>
              )}
              {isError && (
                <div className="py-24 text-center" style={{ fontSize: 16, color: 'rgba(255,255,255,0.4)' }}>
                  Couldn't load her stats. Try again.
                </div>
              )}
              {data && <StatsBody d={data} onNavigate={navigate} onClose={onClose} />}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}

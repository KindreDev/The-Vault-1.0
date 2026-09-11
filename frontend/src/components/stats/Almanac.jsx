/**
 * <Almanac /> — the long view of a collecting life.
 *
 * Stats answers "what is true now" and Analytics owns usage trends. This
 * component answers "how did the collection itself change over the years?".
 *
 * Critical framing, learned the hard way: collection history runs six years
 * deep, usage history only goes back to when the app was built. Mixing them
 * produces confidently wrong conclusions, so each block states which era it is
 * reading from.
 */
import React from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  CalendarRange, Users, Sparkles, Clock, Layers, Info,
} from 'lucide-react'
import { sessionsApi } from '../../lib/api'
import { useT } from '../../i18n'

const num = (n) => (n ?? 0).toLocaleString()

function EraBadge({ era }) {
  const label = era === 'collection' ? 'Collection history · 6 years' : 'Usage · since the app was built'
  const color = era === 'collection' ? 'var(--c-amber-text)' : 'var(--c-accent)'
  return (
    <span className="px-2 py-0.5 rounded-full flex-shrink-0"
          style={{ fontSize: 16, color, background: `${color}18`, border: `0.5px solid ${color}44` }}>
      {label}
    </span>
  )
}

function Card({ icon: Icon, title, subtitle, era, accent = 'var(--c-accent)', children }) {
  return (
    <div className="vault-card p-5">
      <div className="flex items-start gap-3 mb-4 flex-wrap">
        <div className="w-9 h-9 rounded-[10px] flex items-center justify-center flex-shrink-0"
             style={{ background: `${accent}20`, border: `0.5px solid ${accent}44` }}>
          <Icon size={17} style={{ color: accent }} />
        </div>
        <div className="flex-1 min-w-0">
          <div style={{ fontSize: 19, fontWeight: 700, color: 'rgba(255,255,255,0.9)' }}>{title}</div>
          {subtitle && <div style={{ fontSize: 16, color: 'rgba(255,255,255,0.35)' }}>{subtitle}</div>}
        </div>
        {era && <EraBadge era={era} />}
      </div>
      {children}
    </div>
  )
}

function Tile({ label, value, sub, accent = 'rgba(255,255,255,0.92)' }) {
  return (
    <div className="rounded-[10px] px-4 py-3"
         style={{ background: 'rgba(255,255,255,0.03)', border: '0.5px solid rgba(255,255,255,0.06)' }}>
      <div style={{ fontSize: 16, color: 'rgba(255,255,255,0.4)' }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 800, color: accent, lineHeight: 1.15 }}>{value}</div>
      {sub && <div style={{ fontSize: 16, color: 'rgba(255,255,255,0.3)' }}>{sub}</div>}
    </div>
  )
}

/** Dual-series year chart: bars for galleries, a line-ish overlay for depth. */
function YearChart({ years }) {
  if (!years?.length) return null
  const maxG = Math.max(1, ...years.map(y => y.galleries))
  const maxD = Math.max(1, ...years.map(y => y.files_per_gallery))
  return (
    <div>
      <div className="flex items-end gap-2" style={{ height: 190 }}>
        {years.map(y => {
          const gh = (y.galleries / maxG) * 150
          const dh = (y.files_per_gallery / maxD) * 150
          return (
            <div key={y.year} className="flex-1 flex flex-col items-center gap-1 min-w-0">
              <div style={{ fontSize: 16, color: 'rgba(255,255,255,0.45)', whiteSpace: 'nowrap' }}>
                {y.galleries >= 1000 ? `${(y.galleries / 1000).toFixed(1)}k` : y.galleries}
              </div>
              <div className="w-full relative flex items-end justify-center" style={{ height: 150 }}>
                <div className="w-full rounded-t-[4px]"
                     title={`${y.year}: ${num(y.galleries)} galleries, ${num(y.files)} files`}
                     style={{ height: Math.max(3, gh),
                              background: 'linear-gradient(to top, var(--c-accent), var(--c-accent-text))' }} />
                {/* Depth marker — files per gallery, on its own scale */}
                <div className="absolute left-0 right-0"
                     title={`${y.files_per_gallery} files per gallery`}
                     style={{ bottom: Math.max(2, dh), height: 2, background: 'var(--c-green-text)' }} />
              </div>
              <div style={{ fontSize: 16, color: 'rgba(255,255,255,0.35)' }}>{`'${String(y.year).slice(2)}`}</div>
            </div>
          )
        })}
      </div>
      <div className="flex items-center gap-4 mt-3">
        <span style={{ fontSize: 16, color: 'var(--c-accent-text)' }}>▮ galleries acquired</span>
        <span style={{ fontSize: 16, color: 'var(--c-green-text)' }}>▬ files per gallery (depth)</span>
      </div>
    </div>
  )
}

function RosterChart({ years }) {
  if (!years?.length) return null
  const max = Math.max(1, ...years.map(y => y.creators))
  return (
    <div className="flex items-end gap-2" style={{ height: 130 }}>
      {years.map(y => {
        const total = (y.creators / max) * 96
        const fresh = y.creators ? (y.new_creators / y.creators) * total : 0
        return (
          <div key={y.year} className="flex-1 flex flex-col items-center gap-1 min-w-0">
            <div style={{ fontSize: 16, color: 'rgba(255,255,255,0.4)' }}>{y.creators}</div>
            <div className="w-full flex flex-col justify-end rounded-t-[4px] overflow-hidden"
                 title={`${y.year}: ${y.creators} followed · ${y.new_creators} new`}
                 style={{ height: Math.max(3, total), background: 'color-mix(in srgb, var(--c-accent) 45%, transparent)' }}>
              <div style={{ height: fresh, background: 'var(--c-amber-text)' }} />
            </div>
            <div style={{ fontSize: 16, color: 'rgba(255,255,255,0.35)' }}>{`'${String(y.year).slice(2)}`}</div>
          </div>
        )
      })}
    </div>
  )
}

export default function Almanac() {
  const t = useT()
  const { data, isLoading } = useQuery({
    queryKey: ['almanac'],
    queryFn: () => sessionsApi.almanac().then(r => r.data),
    staleTime: 60_000,
  })

  if (isLoading || !data) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-24">
        <div className="skeleton" style={{ width: 200, height: 16, borderRadius: 8 }} />
        <div style={{ fontSize: 16, color: 'rgba(255,255,255,0.3)' }}>{t('Reading the archive…')}</div>
      </div>
    )
  }

  const lv = data.long_view || {}
  const hb = data.habits || {}
  const years = lv.years || []
  const peakRoster = years.reduce((best, year) => year.creators > (best?.creators ?? -1) ? year : best, null)
  const latestRoster = years.at(-1)

  return (
    <div className="flex flex-col gap-5">

      {/* ── The Read ────────────────────────────────────────────────────── */}
      {data.lines?.length > 0 && (
        <Card icon={Sparkles} title={t('What this says')}
              subtitle={t('Worked out from your own numbers — it updates as you use the app')}
              accent="var(--c-amber-text)">
          <div className="flex flex-col gap-3">
            {data.lines.map((l, i) => (
              <div key={i} className="rounded-[10px] px-4 py-3"
                   style={{ background: 'rgba(255,255,255,0.03)', border: '0.5px solid rgba(255,255,255,0.06)' }}>
                <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--c-amber-text)', marginBottom: 3 }}>{l.title}</div>
                <div style={{ fontSize: 16, color: 'rgba(255,255,255,0.6)', lineHeight: 1.55 }}>{l.body}</div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* ── The long view ───────────────────────────────────────────────── */}
      <Card icon={CalendarRange} title={t('Your collecting years')}
            subtitle={t('Built from gallery subscription periods — this predates the app entirely')}
            era="collection" accent="var(--c-accent)">
        <YearChart years={years} />
        <div className="grid gap-3 mt-4" style={{ gridTemplateColumns: 'repeat(4, minmax(0,1fr))' }}>
          <Tile label={t('Peak year')} value={lv.peak_year ?? '—'}
                sub={lv.peak_year_share ? `${lv.peak_year_share}% of everything` : undefined}
                accent="var(--c-amber-text)" />
          <Tile label={t('Collecting since')} value={lv.first_year ?? '—'} />
          <Tile label={t('Dated galleries')} value={num(lv.total_galleries_dated)} />
          <Tile label={t('Depth now')}
                value={years.length ? `${years[years.length - 1].files_per_gallery}` : '—'}
                sub={t('files per set')} accent="var(--c-green-text)" />
        </div>
      </Card>

      {/* ── Eras ────────────────────────────────────────────────────────── */}
      {lv.eras?.length > 0 && (
        <Card icon={Layers} title={t('The phases')}
              subtitle={t('Detected from the shape of the curve')} era="collection" accent="var(--c-amber)">
          <div className="flex flex-col gap-2">
            {lv.eras.map((e, i) => (
              <div key={i} className="flex items-center gap-4 px-4 py-3 rounded-[10px]"
                   style={{ background: 'rgba(255,255,255,0.03)', border: '0.5px solid rgba(255,255,255,0.06)' }}>
                <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--c-amber-text)', minWidth: 130 }}>{e.name}</div>
                <div className="font-mono" style={{ fontSize: 16, color: 'rgba(255,255,255,0.4)', minWidth: 96 }}>
                  {e.from === e.to ? e.from : `${e.from}–${e.to}`}
                </div>
                <div style={{ fontSize: 16, color: 'rgba(255,255,255,0.55)' }}>{e.note}</div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* ── Roster ──────────────────────────────────────────────────────── */}
      <Card icon={Users} title={t('Your roster over time')}
            subtitle={t('Creators represented each year — gold is new that year')}
            era="collection" accent="var(--c-green)">
        <RosterChart years={years} />
        <div className="grid gap-3 mt-4" style={{ gridTemplateColumns: 'repeat(4, minmax(0,1fr))' }}>
          <Tile label={t('Creators in the vault')} value={num(hb.creators_total)} />
          <Tile label={t('Roster tracked since')} value={years[0]?.year ?? '—'} />
          <Tile label={t('Largest roster year')} value={peakRoster?.creators ?? '—'}
                sub={peakRoster ? String(peakRoster.year) : undefined} accent="var(--c-amber-text)" />
          <Tile label={t('Newest additions')} value={latestRoster?.new_creators ?? '—'}
                sub={latestRoster ? String(latestRoster.year) : undefined} accent="var(--c-green-text)" />
        </div>
      </Card>

      {/* ── Curation ────────────────────────────────────────────────────── */}
      <Card icon={Info} title={t('Curation health')} subtitle={t('How well kept the archive is')}
            accent="var(--c-green)">
        <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(4, minmax(0,1fr))' }}>
          <Tile label={t('AI tagged')} value={`${hb.tagged_pct ?? 0}%`} sub={num(hb.ai_tagged_files)} accent="var(--c-accent-text)" />
          <Tile label={t('Rated by hand')} value={`${hb.rated_pct ?? 0}%`} sub={num(hb.rated_files)} accent="var(--c-amber-text)" />
          <Tile label={t('Assigned to a creator')} value={`${hb.assigned_pct ?? 0}%`}
                sub={`${num(hb.galleries_unassigned)} unassigned`} />
          <Tile label={t('Favourites')} value={num(hb.favorite_files)} />
        </div>
      </Card>

      {/* ── Cross-check ─────────────────────────────────────────────────── */}
      {lv.cross_check?.length > 0 && (
        <Card icon={Clock} title={t('Cross-check')}
              subtitle={t('Two independent records of the same years — do they agree?')}
              era="collection" accent="#378ADD">
          <div style={{ fontSize: 16, color: 'rgba(255,255,255,0.5)', lineHeight: 1.55, marginBottom: 14 }}>
            {t('Gallery periods are what you tagged. File dates are what the files themselves say. They were recorded separately and never compare notes, so where they line up the shape of your collecting years is real and not an artefact.')}
          </div>
          <div className="flex flex-col gap-1.5">
            {lv.cross_check.map(c => (
              <div key={c.year} className="flex items-center gap-3 px-3 py-2 rounded-[8px]"
                   style={{ background: 'rgba(255,255,255,0.03)' }}>
                <span className="font-mono" style={{ fontSize: 16, color: 'rgba(255,255,255,0.5)', width: 52 }}>{c.year}</span>
                <span style={{ fontSize: 16, color: 'rgba(255,255,255,0.7)', width: 110 }}>{num(c.by_period)}</span>
                <span style={{ fontSize: 16, color: 'rgba(255,255,255,0.7)', width: 110 }}>{num(c.by_file_date)}</span>
                <span style={{ fontSize: 16, color: c.agrees ? 'var(--c-green-text)' : 'var(--c-amber-text)' }}>
                  {c.agrees ? `✓ within ${c.delta_pct}%` : `off by ${c.delta_pct}%`}
                </span>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-3 mt-3" style={{ fontSize: 16, color: 'rgba(255,255,255,0.3)' }}>
            <span style={{ width: 52 }}>{t('year')}</span>
            <span style={{ width: 110 }}>{t('by period')}</span>
            <span style={{ width: 110 }}>{t('by file date')}</span>
            <span style={{ color: 'var(--c-green-text)' }}>{lv.cross_check_agreement}% {t('agreement')}</span>
          </div>
        </Card>
      )}
    </div>
  )
}

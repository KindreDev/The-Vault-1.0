import React from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import {
  Activity, Crown, Gauge, History, Layers3,
  Loader2, Mountain, Sparkles, Trophy,
} from 'lucide-react'
import { sessionsApi } from '../../lib/api'
import { LocalizedText, useT } from '../../i18n'
import './analytics.css'

const RANGES = ['7d', '30d', '90d', 'all']
const AGGREGATIONS = ['daily', 'weekly', 'monthly']
const METRICS = [
  ['sessions', 'Sessions'],
  ['session_minutes', 'Total session time'],
  ['finishes', 'Orgasms'],
  ['edges', 'Edges'],
  ['viewing_time', 'Viewing time'],
]
const METRIC_DETAILS = {
  sessions: { axis: 'Sessions', unit: '' },
  session_minutes: { axis: 'Total session time · minutes', unit: ' min' },
  finishes: { axis: 'Orgasms', unit: '' },
  edges: { axis: 'Edges', unit: '' },
  viewing_time: { axis: 'Viewing time · minutes', unit: ' min' },
}

const asArray = (value) => Array.isArray(value) ? value : []
const numeric = (value) => Number.isFinite(Number(value)) ? Number(value) : 0
const labelForPoint = (point, index) => point?.date || point?.period || point?.label || point?.name || (point?.hour != null ? `${point.hour}:00` : String(index + 1))
const valueForPoint = (point) => numeric(point?.value ?? point?.count ?? point?.minutes ?? point?.duration_minutes ?? point?.hours ?? point?.sessions ?? point?.session_minutes ?? point?.viewing_minutes ?? point?.edges_per_session ?? point?.share_of_views ?? point?.share_of_viewing ?? point?.first_tracked_share ?? point?.average_duration_sec ?? point?.duration_sec ?? point?.seconds)

function ToggleGroup({ label, value, options, onChange }) {
  const t = useT()
  return (
    <div className="analytics-control" aria-label={t(label)}>
      <span>{t(label)}</span>
      <div>
        {options.map(option => {
          const id = Array.isArray(option) ? option[0] : option
          const text = Array.isArray(option) ? t(option[1]) : option === 'all' ? t('All time') : t(option.toUpperCase())
          return <button type="button" key={id} className={value === id ? 'is-active' : ''} onClick={() => onChange(id)}>{text}</button>
        })}
      </div>
    </div>
  )
}

function SectionTitle({ icon: Icon, eyebrow, title, copy }) {
  const t = useT()
  return (
    <header className="analytics-section-title">
      <span className="analytics-section-icon"><Icon size={21} /></span>
      <div><span>{t(eyebrow)}</span><h2>{t(title)}</h2>{copy && <p>{t(copy)}</p>}</div>
    </header>
  )
}

function Panel({ title, question, children, className = '' }) {
  const t = useT()
  return (
    <section className={`analytics-panel ${className}`}>
      <header><h3>{t(title)}</h3>{question && <p>{t(question)}</p>}</header>
      {children}
    </section>
  )
}

function Unavailable({ children = 'This insight needs telemetry that is not being tracked yet.' }) {
  const t = useT()
  return <div className="analytics-unavailable"><History size={22} /><span>{typeof children === 'string' ? t(children) : children}</span></div>
}

function LoadingState() {
  return <div className="analytics-loading"><Loader2 size={30} /><span><LocalizedText text="Reading your history…" /></span></div>
}

function formatNumber(value, suffix = '') {
  return `${numeric(value).toLocaleString(undefined, { maximumFractionDigits: 1 })}${suffix}`
}

function useChartWidth() {
  const ref = React.useRef(null)
  const [width, setWidth] = React.useState(900)
  React.useLayoutEffect(() => {
    const element = ref.current
    if (!element) return undefined
    const update = () => setWidth(Math.max(320, Math.round(element.getBoundingClientRect().width)))
    update()
    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  return [ref, width]
}

function niceMaximum(value) {
  if (value <= 1) return 1
  const magnitude = 10 ** Math.floor(Math.log10(value))
  const normalized = value / magnitude
  const nice = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10
  return nice * magnitude
}

function TrendChart({ data, rolling = true, previous = false, unit = '', axisLabel = 'Value', onInspect, color = 'var(--c-accent)', compact = false }) {
  const t = useT()
  const points = asArray(data)
  const [chartRef, width] = useChartWidth()
  if (!points.length) return <Unavailable><LocalizedText text="No historical samples are available for this view yet." /></Unavailable>
  const displayUnit = unit === ' min' ? ` ${t('min')}` : unit
  const series = points.map(valueForPoint)
  const hasExplicitRolling = points.some(p => p.rolling_average != null || p.rolling != null || p.average != null)
  const rollingSeries = points.map((p, index) => {
    const explicit = p.rolling_average ?? p.rolling ?? p.average
    if (explicit != null) return numeric(explicit)
    const slice = series.slice(Math.max(0, index - 6), index + 1)
    return slice.reduce((sum, value) => sum + value, 0) / slice.length
  })
  const hasPrevious = points.some(p => p.previous_value != null || p.previous != null)
  const previousSeries = points.map(p => numeric(p.previous_value ?? p.previous))
  const all = [...series, ...(rolling ? rollingSeries : []), ...(previous && hasPrevious ? previousSeries : [])]
  const rawMax = niceMaximum(Math.max(1, ...all))
  const countAxis = unit === ''
  const tickStep = countAxis ? Math.max(1, Math.ceil(rawMax / 4)) : rawMax / 4
  const max = tickStep * 4
  const height = compact ? 170 : 310
  const plot = compact
    ? { left: 88, right: 22, top: 24, bottom: height - 30 }
    : { left: 88, right: 22, top: 34, bottom: height - 48 }
  const x = i => points.length === 1 ? (plot.left + width - plot.right) / 2 : plot.left + (i / (points.length - 1)) * (width - plot.left - plot.right)
  const y = v => plot.bottom - (numeric(v) / max) * (plot.bottom - plot.top)
  const path = values => values.map((v, i) => `${i ? 'L' : 'M'} ${x(i)} ${y(v)}`).join(' ')
  const areaPath = `${path(series)} L ${x(points.length - 1)} ${plot.bottom} L ${x(0)} ${plot.bottom} Z`
  const xTicks = [0, Math.floor((points.length - 1) / 2), points.length - 1].filter((v, i, a) => a.indexOf(v) === i)
  const yTicks = [0, 1, 2, 3, 4].map(step => ({ step, value: tickStep * step }))
  return (
    <div className={`analytics-trend-wrap${compact ? ' is-compact' : ''}`} ref={chartRef}>
      <svg className="analytics-trend" width={width} height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label={t('{label} trend chart', { label: t(axisLabel) })}>
        <text x={plot.left} y="20" className="analytics-axis-title">{t(axisLabel)}</text>
        {yTicks.map(({ step, value }) => <React.Fragment key={step}>
          <line x1={plot.left} x2={width - plot.right} y1={y(value)} y2={y(value)} className="analytics-gridline" />
          <text x={plot.left - 12} y={y(value) + 5} textAnchor="end" className="analytics-axis-value">{formatNumber(value, displayUnit)}</text>
        </React.Fragment>)}
        <path d={areaPath} className="analytics-area" style={{ '--chart-color': color }} />
        <path d={path(series)} className="analytics-line" style={{ '--chart-color': color }} />
        {previous && hasPrevious && <path d={path(previousSeries)} className="analytics-line analytics-line-previous" />}
        {rolling && <path d={path(rollingSeries)} className="analytics-line analytics-line-rolling" />}
        {points.map((point, i) => (
          <circle key={`${labelForPoint(point, i)}-${i}`} cx={x(i)} cy={y(series[i])} r="5" className="analytics-point"
                  onClick={() => onInspect?.(point)} tabIndex={onInspect ? 0 : undefined}>
            <title>{`${labelForPoint(point, i)}: ${formatNumber(series[i], displayUnit)}`}</title>
          </circle>
        ))}
        {xTicks.map(i => <text key={i} x={x(i)} y={height - 12} textAnchor={i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle'}>{labelForPoint(points[i], i)}</text>)}
      </svg>
      <div className="analytics-legend">
        <span><i className="raw" />{t('Recorded')}</span>
        {rolling && <span><i className="rolling" />{t(hasExplicitRolling ? 'Rolling average' : '7-point average')}</span>}
        {previous && <span><i className="previous" />{t(hasPrevious ? 'Previous period' : 'Previous period unavailable')}</span>}
      </div>
    </div>
  )
}

function NoveltyBreakdown({ data }) {
  const t = useT()
  const rows = asArray(data).filter(row => numeric(row.first_tracked_views) + numeric(row.rewatches) > 0).slice(-12)
  if (!rows.length) return <Unavailable><LocalizedText text="New-versus-rewatched history appears after file views are tracked." /></Unavailable>
  return <div className="analytics-novelty">
    <div className="analytics-novelty-explainer"><strong>{t('New to you')}</strong> {t('means the first recorded view of a file.')} <strong>{t('Rewatched')}</strong> {t('means every later view.')}</div>
    <div className="analytics-novelty-legend"><span><i className="new" />{t('New to you')}</span><span><i className="rewatched" />{t('Rewatched')}</span></div>
    <div className="analytics-novelty-rows">{rows.map(row => {
      const total = numeric(row.first_tracked_views) + numeric(row.rewatches)
      const newPct = total ? numeric(row.first_tracked_views) / total * 100 : 0
      return <div key={row.period} className="analytics-novelty-row">
        <span>{row.period}</span>
        <div title={t('{newPct}% new · {rewatchedPct}% rewatched', { newPct: formatNumber(newPct), rewatchedPct: formatNumber(100 - newPct) })}><i className="new" style={{ width: `${newPct}%` }} /><i className="rewatched" style={{ width: `${100 - newPct}%` }} /></div>
        <strong>{formatNumber(newPct, '%')} {t('new')}</strong>
      </div>
    })}</div>
  </div>
}

function Bars({ data, horizontal = false, valueSuffix = '' }) {
  const rows = asArray(data)
  if (!rows.length) return <Unavailable />
  const max = Math.max(1, ...rows.map(valueForPoint))
  return (
    <div className={horizontal ? 'analytics-bars is-horizontal' : 'analytics-bars'}>
      {rows.map((row, index) => {
        const value = valueForPoint(row)
        return <div className="analytics-bar-item" key={`${labelForPoint(row, index)}-${index}`}>
          <span>{labelForPoint(row, index)}</span>
          <div><i style={{ '--bar-size': `${Math.max(2, (value / max) * 100)}%` }} /></div>
          <strong>{formatNumber(value, valueSuffix)}</strong>
        </div>
      })}
    </div>
  )
}

function Heatmap({ data }) {
  const t = useT()
  const cells = asArray(data)
  if (!cells.length) return <Unavailable><LocalizedText text="The day-by-hour map will unlock as timestamped sessions accumulate." /></Unavailable>
  const indexed = new Map(cells.map(cell => [`${numeric(cell.day ?? cell.weekday)}-${numeric(cell.hour)}`, valueForPoint(cell)]))
  const max = Math.max(1, ...cells.map(valueForPoint))
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(day => t(day))
  return (
    <div className="analytics-heatmap-scroll">
      <div className="analytics-heatmap">
        <span />{[0, 3, 6, 9, 12, 15, 18, 21].map(h => <span key={h}>{h}:00</span>)}
        {days.map((day, dayIndex) => <React.Fragment key={day}>
          <strong>{day}</strong>
          {Array.from({ length: 24 }, (_, hour) => {
            const value = indexed.get(`${dayIndex}-${hour}`) ?? indexed.get(`${dayIndex + 1}-${hour}`) ?? 0
            return <i key={hour} style={{ '--heat': Math.max(0.04, value / max) }} title={`${day} ${hour}:00 · ${value}`} />
          })}
        </React.Fragment>)}
      </div>
    </div>
  )
}

function MultiTrend({ data, metrics }) {
  const groups = asArray(data)
  const [chosen, setChosen] = React.useState(() => groups.slice(0, 3).map(group => group.id ?? group.name))
  const [measure, setMeasure] = React.useState(metrics?.[0]?.[0])
  React.useEffect(() => { setChosen(current => current.filter(id => groups.some(group => (group.id ?? group.name) === id))) }, [data])
  if (!groups.length) return <Unavailable><LocalizedText text="Tag and creator trend lines appear once viewing events retain content relationships." /></Unavailable>
  const visible = groups.filter(group => chosen.includes(group.id ?? group.name)).slice(0, 6)
  const measureLabel = metrics?.find(([id]) => id === measure)?.[1] || 'Value'
  const measureUnit = measure?.startsWith('share_') ? '%' : ''
  return <>{metrics?.length > 1 && <ToggleGroup label="Measure" value={measure} options={metrics} onChange={setMeasure} />}<div className="analytics-trend-pickers">{groups.slice(0, 18).map(group => {
    const id = group.id ?? group.name
    const active = chosen.includes(id)
    return <button type="button" className={active ? 'is-active' : ''} key={id} onClick={() => setChosen(current => active ? current.filter(value => value !== id) : current.length < 6 ? [...current, id] : current)}>{group.name || group.label}</button>
  })}</div><div className="analytics-ranked-trends">{visible.map((group, i) => (
    <div key={group.name || i}><span><i style={{ '--rank': i }} />{group.name || group.label}</span><TrendChart data={asArray(group.points || group.series).map(point => ({ ...point, value: point[measure] }))} rolling={false} color={`var(--analytics-series-${i % 4})`} axisLabel={measureLabel} unit={measureUnit} compact /></div>
  ))}</div></>
}

function TopN({ data, kind }) {
  const periods = asArray(data)
  if (!periods.length || !periods.some(item => ['creators', 'characters', 'franchises', 'tags'].some(key => asArray(item[key]).length))) return <Unavailable><LocalizedText text="Monthly rankings need tracked viewing or session history." /></Unavailable>
  return <div className="analytics-topn">{periods.slice(-8).map(period => <article key={period.period}><strong>{period.period}</strong><ol>{asArray(period[kind]).slice(0, 3).map(item => <li key={item.id ?? item.name}><span>{item.name}</span><b>{formatNumber(item.value)}</b></li>)}</ol></article>)}</div>
}

function SessionInspector({ point, onClose }) {
  const t = useT()
  if (!point) return null
  const sessions = asArray(point.underlying_sessions || point.session_rows)
  return <aside className="analytics-inspector">
    <button type="button" onClick={onClose} aria-label={t('Close session details')}>×</button>
    <h3>{point.date || point.period || 'Selected period'}</h3>
    <p>{t('{value} recorded in this point.', { value: formatNumber(valueForPoint(point)) })}</p>
    {sessions.length ? <ul>{sessions.slice(0, 8).map((session, i) => <li key={session.id || i}><span>{session.creator_name || session.gallery_name || t('Session {id}', { id: session.id || i + 1 })}</span><strong>{formatNumber((session.duration_sec || 0) / 60, ` ${t('min')}`)}</strong></li>)}</ul> : <Unavailable><LocalizedText text="Underlying session rows were not included in this response." /></Unavailable>}
  </aside>
}

function Comparison({ candidates }) {
  const t = useT()
  const sessions = asArray(candidates)
  const [selected, setSelected] = React.useState([])
  const ids = selected.join(',')
  const { data, isFetching } = useQuery({
    queryKey: ['analytics-comparison', ids],
    queryFn: () => sessionsApi.compare(ids).then(r => r.data),
    enabled: selected.length >= 2,
  })
  if (sessions.length < 2) return <Unavailable><LocalizedText text="Comparison needs at least two sessions with duration telemetry." /></Unavailable>
  const compared = asArray(data?.sessions || data)
  return <div className="analytics-comparison">
    <div className="analytics-session-choices">{sessions.slice(0, 12).map((session, i) => {
      const id = session.id
      const active = selected.includes(id)
      return <button type="button" className={active ? 'is-active' : ''} key={id || i} onClick={() => setSelected(current => active ? current.filter(v => v !== id) : current.length < 4 ? [...current, id] : current)}>
        {session.label || session.logged_at?.slice(0, 10) || `Session ${id}`}
      </button>
    })}</div>
    {isFetching ? <LoadingState /> : selected.length < 2 ? <p className="analytics-hint">{t('Choose two to four sessions.')}</p> : compared.length ? <div className="analytics-compare-grid">{compared.map((item, i) => <article key={item.id || i}><h4>{item.label || item.logged_at?.slice(0, 10) || t('Session {id}', { id: item.id })}</h4><dl>{[
      ['Duration', item.duration_minutes ?? (item.duration_sec != null ? item.duration_sec / 60 : null), ' min'], ['Edges', item.edges, ''], ['Files', item.files_viewed ?? item.images?.length, ''], ['Avg SPM', item.average_spm, ''], ['Peak SPM', item.peak_spm, '']
    ].map(([label, value, suffix]) => value != null && <div key={label}><dt>{t(label)}</dt><dd>{formatNumber(value, suffix)}</dd></div>)}</dl></article>)}</div> : <Unavailable><LocalizedText text="The comparison endpoint returned no compatible telemetry." /></Unavailable>}
  </div>
}

function formatRecord(t, record) {
  if (record.unit === 'seconds') return `${formatNumber(numeric(record.value) / 60)} ${t('min')}`
  if (record.unit === 'xp') return `${formatNumber(record.value)} XP`
  const unit = record.unit ? t(record.unit) : ''
  return `${formatNumber(record.value)} ${unit}`.trim()
}

export default function AnalyticsDashboard() {
  const t = useT()
  const [range, setRange] = React.useState('30d')
  const [aggregation, setAggregation] = React.useState('daily')
  const [metric, setMetric] = React.useState('sessions')
  const [rolling, setRolling] = React.useState(true)
  const [previous, setPrevious] = React.useState(false)
  const [timeMetric, setTimeMetric] = React.useState('sessions')
  const [heatMetric, setHeatMetric] = React.useState('sessions')
  const [weekdayMetric, setWeekdayMetric] = React.useState('sessions')
  const [timingView, setTimingView] = React.useState('heatmap')
  const [preferenceEntity, setPreferenceEntity] = React.useState('tags')
  const [preferenceView, setPreferenceView] = React.useState('trends')
  const [inspected, setInspected] = React.useState(null)
  const query = useQuery({
    queryKey: ['analytics', range, aggregation, metric],
    queryFn: () => sessionsApi.analytics({ range, aggregation, metric }).then(r => r.data),
    placeholderData: keepPreviousData,
    staleTime: 30000,
  })
  const topNQuery = useQuery({
    queryKey: ['analytics-top-n', range],
    queryFn: () => sessionsApi.analytics({ range, aggregation: 'monthly', metric: 'sessions' }).then(r => r.data),
    staleTime: 30000,
  })
  const data = query.data || {}
  const activity = data.selected_activity || data.activity_over_time || data.activity || data.time_series
  const duration = asArray(data.session_duration?.sessions || data.session_duration_over_time || data.session_durations).map(point => ({ ...point, date: point.logged_at?.slice(0, 10) || point.date, value: numeric(point.duration_sec) / 60, rolling_average: numeric(point.rolling_average_sec) / 60 }))
  const cumulative = data.cumulative_lifetime_hours?.points || data.cumulative_lifetime_hours || data.cumulative_hours
  const timeOfDay = asArray(data.time_of_day_distribution || data.time_of_day).map(point => ({ ...point, label: `${point.hour}:00`, value: timeMetric === 'average_duration' ? numeric(point.average_duration_sec) / 60 : point[timeMetric] }))
  const heatmap = asArray(data.day_hour_heatmap || data.heatmap).map(point => ({ ...point, value: point[heatMetric === 'viewing_time' ? 'viewing_minutes' : heatMetric] }))
  const weekdays = asArray(data.day_of_week_breakdown || data.weekday_breakdown || data.day_of_week).map(point => ({ ...point, label: point.name, value: weekdayMetric === 'average_duration' ? numeric(point.average_duration_sec) / 60 : point[weekdayMetric] }))
  const buckets = asArray(data.session_length_distribution || data.duration_buckets || data.length_distribution).map(point => ({ ...point, label: point.label ? t(point.label) : point.label, value: point.count }))
  const edgeTrend = asArray(data.edges_per_session_over_time || data.edge_trend || data.edges_over_time).map(point => ({ ...point, value: point.edges_per_session, rolling_average: point.rolling_average_edges_per_session }))
  const novelty = asArray(data.preferences?.novelty || data.novelty_vs_rewatching)
  const summary = data.summary || {}
  const previousSummary = data.previous_period || {}
  const rangeLabel = range === 'all' ? t('All tracked history') : t('Last {count} days', { count: range.slice(0, -1) })
  const delta = (current, prior) => {
    if (range === 'all') return t('Lifetime view')
    if (!numeric(prior)) return numeric(current) ? t('New in this period') : t('No change')
    const change = ((numeric(current) - numeric(prior)) / numeric(prior)) * 100
    return t('{change}% vs previous', { change: `${change > 0 ? '+' : ''}${Math.round(change)}` })
  }
  const preferenceTrends = {
    tags: data.preferences?.tags || data.tag_trends,
    creators: asArray(data.preferences?.creators).filter(item => item.creator_type !== 'character'),
    characters: data.preferences?.characters,
  }
  const preferenceMetrics = preferenceEntity === 'tags'
    ? [["share_of_views", "Share of views"], ["views", "Views"], ["files_viewed", "Files viewed"], ["viewing_seconds", "Viewing seconds"]]
    : [["share_of_viewing", "Share of viewing"], ["viewing_seconds", "Viewing seconds"], ["files_viewed", "Files viewed"], ["sessions", "Sessions"]]

  if (query.isError && !query.data) return <div className="analytics-error"><Activity size={28} /><div><strong>{t('Analytics could not be loaded.')}</strong><span>{query.error?.response?.status === 404 ? t('The Analytics backend is not available in this build.') : t('The Vault could not read your session history. Try again.')}</span></div><button type="button" onClick={() => query.refetch()}>{t('Retry')}</button></div>

  return <div className="analytics-dashboard" aria-busy={query.isFetching}>
    <section className="analytics-page-range">
      <div><strong>{t('Analytics range')}</strong><p>{t('Changes every summary, chart, preference, and personal best on this page.')}</p></div>
      <div className="analytics-page-range-tools">
        {query.isFetching && <span className="analytics-refresh-status" role="status"><Loader2 size={18} /> {t('Updating activity…')}</span>}
        <ToggleGroup label="Time period" value={range} options={RANGES} onChange={setRange} />
      </div>
    </section>
    <div className="analytics-summary">
      {[
        ['Sessions', summary.sessions, delta(summary.sessions, previousSummary.sessions)],
        ['Total session time', summary.session_hours != null ? `${formatNumber(summary.session_hours)}h` : null, delta(summary.session_seconds, previousSummary.session_seconds)],
        ['Viewing hours', summary.viewing_seconds != null ? `${formatNumber(summary.viewing_seconds / 3600)}h` : null, delta(summary.viewing_seconds, previousSummary.viewing_seconds)],
        ['Average session', summary.average_duration_sec != null ? `${Math.round(summary.average_duration_sec / 60)} ${t('min')}` : null, rangeLabel],
        ['Orgasms', summary.finishes, delta(summary.finishes, previousSummary.finishes)],
        ['Edges', summary.edges, delta(summary.edges, previousSummary.edges)],
        ['Edges per orgasm', summary.edges_per_orgasm != null ? `${formatNumber(summary.edges_per_orgasm)}×` : null, rangeLabel],
        ['XP from sessions', summary.session_xp != null ? `${formatNumber(summary.session_xp)} XP` : null, delta(summary.session_xp, previousSummary.session_xp)],
      ].map(([label, value, context]) => <article key={label}><span>{t(label)}</span><strong>{value ?? '—'}</strong><small>{context}</small></article>)}
    </div>
    <section className="analytics-hero">
      <div className="analytics-hero-copy"><span><Mountain size={19} /> {t('Behavior trends')}</span><h1>{t('Activity Over Time')}</h1><p>{t('See the bursts, quiet stretches, and slow shifts hiding inside your history.')}</p></div>
      <div className="analytics-controls">
        <ToggleGroup label="Metric" value={metric} options={METRICS} onChange={setMetric} />
        <ToggleGroup label="Group by" value={aggregation} options={AGGREGATIONS} onChange={setAggregation} />
        <div className="analytics-switches">
          <label><input type="checkbox" checked={rolling} onChange={e => setRolling(e.target.checked)} /> {t('Rolling average')}</label>
          <label><input type="checkbox" checked={previous} onChange={e => setPrevious(e.target.checked)} /> {t('Previous period')}</label>
        </div>
      </div>
      <TrendChart data={activity} rolling={rolling} previous={previous} onInspect={setInspected} axisLabel={METRIC_DETAILS[metric].axis} unit={METRIC_DETAILS[metric].unit} />
      <SessionInspector point={inspected} onClose={() => setInspected(null)} />
    </section>

    <div className="analytics-section">
      <SectionTitle icon={Activity} eyebrow="Behavior" title="How your sessions are changing" copy="Duration, rhythm, timing, and what a normal session actually looks like." />
      <div className="analytics-grid two">
        <Panel title="Session Duration Over Time" question="Are sessions getting longer?"><TrendChart data={duration} rolling axisLabel="Session duration · minutes" unit=" min" /></Panel>
        <Panel title="Session Length Distribution" question="What does a normal session look like?"><Bars data={buckets} horizontal valueSuffix="" /></Panel>
      </div>
      <div className="analytics-grid analytics-timing-row">
        <Panel title="When You Use the Vault" question="Which times and days form a real pattern?">
          <ToggleGroup label="View" value={timingView} options={[["heatmap", "Day × hour"], ["hours", "24 hours"], ["weekdays", "Weekdays"]]} onChange={setTimingView} />
          {timingView === 'heatmap' && <><ToggleGroup label="Measure" value={heatMetric} options={[["sessions", "Sessions"], ["session_minutes", "Total session time"], ["viewing_time", "Viewing time"]]} onChange={setHeatMetric} /><Heatmap data={heatmap} /></>}
          {timingView === 'hours' && <><ToggleGroup label="Measure" value={timeMetric} options={[["sessions", "Sessions"], ["session_minutes", "Minutes"], ["average_duration", "Average duration"]]} onChange={setTimeMetric} /><Bars data={timeOfDay} valueSuffix="" /></>}
          {timingView === 'weekdays' && <><ToggleGroup label="Measure" value={weekdayMetric} options={[["sessions", "Sessions"], ["session_minutes", "Minutes"], ["average_duration", "Average duration"]]} onChange={setWeekdayMetric} /><Bars data={weekdays} valueSuffix="" /></>}
        </Panel>
        <Panel title="Edges per Session" question="Is session style changing over time?"><TrendChart data={edgeTrend} rolling axisLabel="Edges per session" /></Panel>
      </div>
    </div>

    <div className="analytics-section">
      <SectionTitle icon={Layers3} eyebrow="Preferences" title="The eras inside your collection" copy="Track what keeps returning, what suddenly catches fire, and whether you explore or revisit." />
      <div className="analytics-grid two">
        <Panel title="Preference Explorer" question="What is rising, fading, or taking the monthly lead?" className="wide">
          <div className="analytics-explorer-controls">
            <ToggleGroup label="Entity" value={preferenceEntity} options={[["tags", "Tags"], ["creators", "Creators"], ["characters", "Characters"], ["franchises", "Franchises"]]} onChange={value => { setPreferenceEntity(value); if (value === 'franchises') setPreferenceView('rankings') }} />
            <ToggleGroup label="View" value={preferenceView} options={[["trends", "Trend lines"], ["rankings", "Monthly ranking"]]} onChange={value => { if (value === 'trends' && preferenceEntity === 'franchises') setPreferenceEntity('tags'); setPreferenceView(value) }} />
          </div>
          {preferenceView === 'trends' && preferenceEntity !== 'franchises'
            ? <MultiTrend key={preferenceEntity} data={preferenceTrends[preferenceEntity]} metrics={preferenceMetrics} />
            : <TopN data={topNQuery.data?.preferences?.top_n || topNQuery.data?.top_n_over_time} kind={preferenceEntity} />}
        </Panel>
        <Panel title="New vs Rewatched" question="How much of each period was exploration versus returning to familiar files?"><NoveltyBreakdown data={novelty} /></Panel>
      </div>
    </div>

    <div className="analytics-section">
      <SectionTitle icon={Gauge} eyebrow="Compare and records" title="Sessions worth inspecting" copy="Put individual sessions side by side and revisit the moments a new record took the crown." />
      <div className="analytics-grid two">
        <Panel title="Session Comparison" question="What made these sessions different?"><Comparison candidates={duration.map(point => ({ id: point.id, logged_at: point.logged_at, duration_sec: point.duration_sec }))} /></Panel>
        <Panel title="Personal Bests" question="What are the strongest single-session records in this range?">{asArray(data.records?.personal_bests || data.records?.timeline || data.personal_records).length ? <div className="analytics-records">{asArray(data.records?.personal_bests || data.records?.timeline || data.personal_records).map((record, i) => <article key={record.record || i}><span><Trophy size={19} /></span><div><strong>{t(record.title || record.metric || record.record?.replaceAll('_', ' '))}</strong><p>{record.logged_at?.slice(0, 10) || record.date || record.recorded_at} · {formatRecord(t, record)}</p></div></article>)}</div> : <Unavailable><LocalizedText text="Personal bests will appear once this range contains compatible session telemetry." /></Unavailable>}</Panel>
      </div>
    </div>

    <div className="analytics-section">
      <SectionTitle icon={Crown} eyebrow="Accumulation" title="The selected-range climb" copy="Cumulative session time inside the range selected at the top of this page." />
      <Panel title="Cumulative Session Hours" question="How quickly did session time accumulate?"><TrendChart data={cumulative} rolling={false} unit={t('h')} axisLabel="Cumulative session hours" color="var(--c-pink)" /><div className="analytics-milestones">{asArray(data.cumulative_lifetime_hours?.milestones).map(hours => <span className={numeric(cumulative?.at?.(-1)?.hours) >= hours ? 'is-reached' : ''} key={hours}>{hours.toLocaleString()}{t('h')}</span>)}</div></Panel>
    </div>

    <Link className="analytics-recap-link" to="/recap">
      <span><Sparkles size={25} /></span>
      <div><strong>{t('Want the story instead of the charts?')}</strong><p>{t('Recap turns your day, week, month, or year into a designed snapshot.')}</p></div>
      <b>{t('Open Recap')} →</b>
    </Link>
  </div>
}

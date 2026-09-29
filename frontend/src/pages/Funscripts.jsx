import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  Activity, ArrowDown, ArrowUp, Check, ChevronDown, ExternalLink, Heart, ListMusic, LoaderCircle,
  Play, Plus, RefreshCw, Search, SlidersHorizontal,
  Sparkles, Star, Tag, Trash2, X,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { funscriptsApi } from '../lib/api'
import { useFunscriptPlayerStore } from '../store/funscriptPlayerStore'
import { LocalizedText, useT } from '../i18n'
import './funscripts.css'

const FILTERS = {
  intensity: ['All intensity', 'Intense', 'High', 'Medium', 'Low'],
  speed: ['All speed', 'Very fast', 'Fast', 'Moderate', 'Slow'],
  range: ['All range', 'Full-range', 'Mid-range', 'Short strokes'],
  focus: ['All focus', 'High-zone', 'Low-zone', 'Unclassified'],
  axes: ['All axes', 'L0', 'R0', 'L0 + R0', 'Multi-axis'],
  compatibility: ['All compatibility', 'Vibrator compatible', 'Multi-axis compatible'],
  health: ['All health', 'Ready', 'Needs review', 'Unmatched'],
}

const SORTS = [
  ['title', 'Name'], ['rating', 'Rating'], ['max_speed', 'Max speed'], ['avg_speed', 'Avg speed'], ['duration', 'Duration'], ['actions', 'Actions'],
  ['intensity', 'Intensity'],
  ['active_time', 'Active time'], ['high_focus', 'High-zone focus'], ['low_focus', 'Low-zone focus'],
  ['labels', 'Labels'], ['last_played', 'Last played'],
]

const DEFAULT_SORT_DIRECTIONS = {
  title: 'asc',
  labels: 'asc',
  last_played: 'desc',
}

function unwrap(data) {
  if (Array.isArray(data)) return data
  return data?.items || data?.scripts || data?.funscripts || data?.results || []
}

function normalizeScript(raw, index) {
  const sourceVideo = raw.source_video || raw.source_image || raw.video || raw.image || null
  const axes = raw.axes || raw.axis_names || (raw.multi_axis ? ['L0', 'R0'] : ['L0'])
  const manualTags = raw.manual_tags || (raw.tags || []).filter(tag => typeof tag !== 'object' || tag.source !== 'system')
  const tags = manualTags.map(tag => typeof tag === 'string' ? tag : tag.name).filter(Boolean)
  const compatibilityTags = raw.compatibility_tags || (raw.tags || []).filter(tag => typeof tag === 'object' && tag.source === 'system').map(tag => tag.name)
  const numericIntensity = Number(raw.intensity)
  const highFocus = Number(raw.high_focus)
  const lowFocus = Number(raw.low_focus)
  const intensity = raw.intensity_label || (Number.isFinite(numericIntensity) && numericIntensity > 0
    ? numericIntensity >= 70 ? 'Intense' : numericIntensity >= 45 ? 'High' : numericIntensity >= 20 ? 'Medium' : 'Low'
    : (raw.intensity || 'Unanalyzed'))
  return {
    ...raw,
    id: raw.id ?? raw.script_id ?? `script-${index}`,
    title: raw.title || raw.name || raw.filename || 'Untitled script',
    author: raw.author || raw.creator || raw.source_author || 'Unknown author',
    source: raw.source_name || raw.origin || raw.site || 'Local library',
    duration: Number(raw.duration ?? raw.duration_seconds ?? 0),
    actions: Number(raw.actions ?? raw.action_count ?? raw.points ?? 0),
    rating: Number(raw.rating ?? raw.score ?? 0),
    avg_speed: Number(raw.avg_speed ?? raw.average_speed ?? 0),
    p95_speed: Number(raw.p95_speed ?? raw.percentile_95_speed ?? 0),
    max_speed: Number(raw.max_speed ?? raw.maximum_speed ?? 0),
    intensity,
    focus: raw.focus_label || raw.focus || (Number.isFinite(highFocus) && highFocus > 0 ? `High-zone ${Math.round(highFocus * 100)}%` : Number.isFinite(lowFocus) && lowFocus > 0 ? `Low-zone ${Math.round(lowFocus * 100)}%` : 'Unclassified'),
    range: raw.range_label || raw.range || (Number(raw.movement_range) >= 70 ? 'Full-range' : Number(raw.movement_range) >= 40 ? 'Mid-range' : 'Short strokes'),
    axes: Array.isArray(axes) ? axes : [String(axes)],
    tags,
    manualTags,
    compatibilityTags,
    favorite: Boolean(raw.favorite ?? raw.is_favorite),
    last_played: raw.last_played ?? raw.last_played_at,
    health: raw.health || (raw.health_status === 'healthy' ? 'Ready' : raw.health_status === 'missing' ? 'Unmatched' : raw.health_status === 'invalid' ? 'Needs review' : (raw.coverage === 100 || raw.coverage_percent === 100 ? 'Ready' : 'Needs review')),
    active_time: Number(raw.active_time ?? raw.active_percent ?? (raw.active_ratio != null ? Number(raw.active_ratio) * 100 : 0)),
    coverage: Number(raw.coverage ?? raw.coverage_percent ?? 0),
    sourceVideo,
    image_id: raw.image_id ?? raw.source_image_id ?? sourceVideo?.id,
    gallery_id: raw.gallery_id ?? sourceVideo?.gallery_id,
    vibrator_compatible: Boolean(raw.vibrator_compatible ?? compatibilityTags.some(tag => String(tag).toLowerCase() === 'vibrator compatible')),
    multi_axis: Boolean(raw.multi_axis ?? (compatibilityTags.some(tag => String(tag).toLowerCase() === 'multi axis') || axes.length > 1)),
    waveform: raw.waveform || raw.waveform_points,
  }
}

function formatDuration(seconds) {
  const value = Number(seconds)
  if (!Number.isFinite(value) || value <= 0) return '—'
  const mins = Math.floor(value / 60)
  return `${mins}:${String(Math.floor(value % 60)).padStart(2, '0')}`
}

function formatMetric(value) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? Math.round(number).toLocaleString() : '—'
}

function formatSpeed(value) {
  return formatMetric(value)
}

function sortScriptRecords(records, key, direction) {
  const intensityRank = { 'Unanalyzed': 0, Low: 1, Medium: 2, High: 3, Intense: 4 }
  const labelValue = script => [
    script.intensity,
    script.focus,
    ...(script.axes || []),
    ...(script.tags || []),
  ].filter(Boolean).join(' ')
  const valueFor = script => {
    if (key === 'labels') return labelValue(script)
    if (key === 'last_played') return script.last_played ? new Date(script.last_played).getTime() || 0 : 0
    if (key === 'intensity') return intensityRank[script.intensity] ?? 0
    if (key === 'title') return script.title || ''
    return Number(script[key] || 0)
  }
  const multiplier = direction === 'asc' ? 1 : -1
  return [...records].sort((a, b) => {
    const left = valueFor(a)
    const right = valueFor(b)
    const result = typeof left === 'string' || typeof right === 'string'
      ? String(left).localeCompare(String(right), undefined, { sensitivity: 'base' })
      : left - right
    if (result) return result * multiplier
    return String(a.title || '').localeCompare(String(b.title || ''), undefined, { sensitivity: 'base' })
  })
}

function DropdownSelect({ id, value, options, onChange, prefix = '', labelMap = {} }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [menuStyle, setMenuStyle] = useState(null)
  const rootRef = useRef(null)
  useEffect(() => {
    if (!open) return undefined
    const close = event => {
      if (!event.target.closest(`[data-fs-dropdown="${id}"]`)) setOpen(false)
    }
    const onKeyDown = event => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', onKeyDown) }
  }, [id, open])
  useEffect(() => {
    if (!open) {
      setMenuStyle(null)
      return undefined
    }
    const updateMenuPosition = () => {
      const rect = rootRef.current?.getBoundingClientRect()
      if (!rect) return
      setMenuStyle({ top: `${rect.bottom + 8}px`, left: `${rect.left}px`, minWidth: `${rect.width}px` })
    }
    updateMenuPosition()
    window.addEventListener('resize', updateMenuPosition)
    window.addEventListener('scroll', updateMenuPosition, true)
    return () => {
      window.removeEventListener('resize', updateMenuPosition)
      window.removeEventListener('scroll', updateMenuPosition, true)
    }
  }, [open])
  const label = labelMap[value] || options.find(option => option === value) || options[0]
  return <div ref={rootRef} className={`fs-dropdown ${open ? 'is-open' : ''}`} data-fs-dropdown={id}>
    <button type="button" className="fs-dropdown-button" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(current => !current)}><span>{t(prefix)}{t(label)}</span><ChevronDown size={16} /></button>
    <div className="fs-dropdown-menu" style={menuStyle || undefined} role="listbox" aria-label={t(prefix ? prefix.trim() : (options[0] || id))}>
      {options.map(option => <button type="button" role="option" aria-selected={option === value} className={option === value ? 'is-selected' : ''} key={option} onClick={() => { onChange(option); setOpen(false) }}>{t(labelMap[option] || option)}<i /></button>)}
    </div>
  </div>
}

function Waveform({ script, large = false }) {
  const t = useT()
  const values = useMemo(() => {
    if (!Array.isArray(script.waveform) || !script.waveform.length) return []
    return script.waveform.slice(0, large ? 80 : 44).map(value => {
      const numeric = Number(value) || 0
      return Math.max(0, Math.min(1, numeric / 100))
    })
  }, [script.waveform, large])
  return <div className={`fs-waveform ${large ? 'fs-waveform-large' : ''} ${values.length ? '' : 'fs-waveform-unavailable'}`} aria-label={t('Script waveform')}>
    {values.length ? values.map((v, i) => <i key={i} style={{ height: `${Math.round(v * 100)}%` }} />) : <span><LocalizedText text="Waveform unavailable" /></span>}
  </div>
}

function Badge({ children, tone = 'neutral' }) { return <span className={`fs-badge fs-badge-${tone}`}>{children}</span> }

function InlineTagEditor({ script, draft, setDraft, onSubmit, onClose, availableTags }) {
  const t = useT()
  const current = new Set((script.tags || []).map(tag => String(tag).toLowerCase()))
  const suggestions = availableTags
    .filter(tag => !current.has(String(tag).toLowerCase()) && (!draft.trim() || String(tag).toLowerCase().includes(draft.trim().toLowerCase())))
    .slice(0, 6)
  return <form className="fs-inline-popover fs-inline-tag-editor" onSubmit={onSubmit}>
    <Tag size={16} />
    <div className="fs-inline-input-wrap">
      <input autoFocus value={draft} onChange={event => setDraft(event.target.value)} placeholder={t('Add a manual tag…')} aria-label={t('Manual script tag')} />
      {suggestions.length > 0 && <div className="fs-tag-suggestions">{suggestions.map(tag => <button type="button" key={tag} onClick={() => setDraft(tag)}>{tag}</button>)}</div>}
    </div>
    <button className="fs-inline-submit" type="submit" disabled={!draft.trim()}><LocalizedText text="Add" /></button>
    <button className="fs-inline-close" type="button" onClick={onClose} aria-label={t('Close tag editor')}><X size={16} /></button>
  </form>
}

function InlinePlaylistChooser({ script, playlists, onAdd, onClose }) {
  const t = useT()
  const [query, setQuery] = useState('')
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return playlists.filter(playlist => !needle || String(playlist.name || '').toLowerCase().includes(needle))
  }, [playlists, query])
  return <div className="fs-inline-popover fs-inline-playlist-chooser">
    <div className="fs-playlist-picker-head"><ListMusic size={16} /><strong><LocalizedText text="Add to playlist" /></strong><button className="fs-inline-close" type="button" onClick={onClose} aria-label={t('Close playlist chooser')}><X size={16} /></button></div>
    <label className="fs-playlist-picker-search"><Search size={15} /><input autoFocus value={query} onChange={event => setQuery(event.target.value)} placeholder={t('Search playlists…')} aria-label={t('Search playlists')} /></label>
    <div className="fs-playlist-picker-meta">{t('{shown} of {total} playlists', { shown: filtered.length, total: playlists.length })}</div>
    <div className="fs-playlist-picker-list">
      {filtered.length ? filtered.map(playlist => <button className="fs-playlist-picker-option" type="button" key={playlist.id} onClick={() => onAdd(playlist.id, script.id)}><span><ListMusic size={15} /> {playlist.name}</span><b>{playlist.script_count ?? playlist.items?.length ?? 0}</b></button>) : <span className="fs-playlist-picker-empty"><LocalizedText text="No matching playlists" /></span>}
    </div>
  </div>
}

function RatingControl({ value, onChange }) {
  const t = useT()
  const rating = Math.max(0, Math.min(10, Number(value) || 0))
  return <div className="fs-rating-control" aria-label={t('Script rating')}>
    <span className="fs-rating-label">{rating ? `${rating}/10` : t('Unrated')}</span>
    <div className="fs-rating-stars">{Array.from({ length: 10 }, (_, index) => { const level = index + 1; return <button type="button" key={level} title={t('Rate {level} out of 10', { level })} aria-label={t('Rate {level} out of 10', { level })} onClick={() => onChange(rating === level ? 0 : level)}><Star size={16} fill={level <= rating ? 'currentColor' : 'none'} /></button> })}</div>
  </div>
}

function QueueItem({ item, index, total, onPlay, onRemove, onMove, draggingIndex, dropIndex, onDragStart, onDragOver, onDrop, onDragEnd }) {
  const t = useT()
  return <div className={`fs-queue-item ${draggingIndex === index ? 'is-dragging' : ''} ${dropIndex === index ? 'is-drop-target' : ''}`} draggable onDragStart={event => { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', String(index)); onDragStart(index) }} onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; onDragOver(index) }} onDrop={event => { event.preventDefault(); const from = Number(event.dataTransfer.getData('text/plain')); if (Number.isInteger(from)) onDrop(from, index) }} onDragEnd={onDragEnd}>
    <span className="fs-queue-number">{index + 1}</span>
    <div className="fs-queue-reorder"><button type="button" title={t('Move up')} aria-label={t('Move up')} disabled={index === 0} onClick={() => onMove(index, index - 1)}><ArrowUp size={14} /></button><button type="button" title={t('Move down')} aria-label={t('Move down')} disabled={index === total - 1} onClick={() => onMove(index, index + 1)}><ArrowDown size={14} /></button></div>
    <button type="button" className="fs-queue-main" onClick={() => onPlay(item)}><span className="fs-queue-title" title={item.title}>{item.title === 'Untitled script' ? t('Untitled script') : item.title}</span><span className="fs-queue-duration">{formatDuration(item.duration)}</span></button>
    <button type="button" className="fs-queue-remove" title={t('Remove from queue')} aria-label={t('Remove from queue')} onClick={() => onRemove(item.id)}><X size={15} /></button>
  </div>
}

function playbackBridge(script) {
  // The independent player owns output. This bridge deliberately contains no
  // video element; the player agent can expose the store globally or consume
  // this event without making the collection page depend on its module path.
  const store = useFunscriptPlayerStore || window.useFunscriptPlayerStore || window.__vaultFunscriptPlayerStore
  if (store?.getState?.().playScript) { store.getState().playScript(script); return true }
  window.dispatchEvent(new CustomEvent('vault:play-funscript', { detail: script }))
  return false
}

function SourceVideoLink({ script, navigate }) {
  const t = useT()
  const source = script.sourceVideo
  const galleryId = source?.gallery_id ?? script.gallery_id
  const imageId = source?.id ?? script.image_id
  if (!galleryId && !imageId) return <span className="fs-muted"><LocalizedText text="No source video linked" /></span>
  return <button className="fs-source-link" onClick={() => imageId ? navigate(`/galleries/${galleryId || ''}?openImage=${imageId}`) : navigate(`/galleries/${galleryId}`)}>
    <ExternalLink size={15} /> {source?.filename || script.video_filename || t('Open source video')}
  </button>
}

function ScriptRow({ script, selected, onSelect, onPlay, onFavorite, onAddTag, onRemove, tagTarget, tagDraft, setTagDraft, submitTag, closeTag, availableTags }) {
  const t = useT()
  return <div className={`fs-script-row ${selected ? 'is-selected' : ''}`} onClick={() => onSelect(script)}>
    <button className="fs-play-button" title={t('Play script independently')} onClick={e => { e.stopPropagation(); onPlay(script) }}>
      <Play size={17} fill="currentColor" />
    </button>
    <button className={`fs-heart ${script.favorite ? 'is-favorite' : ''}`} title={t(script.favorite ? 'Remove favorite' : 'Favorite script')} onClick={e => { e.stopPropagation(); onFavorite(script) }}>
      <Heart size={19} fill={script.favorite ? 'currentColor' : 'none'} />
    </button>
    <div className="fs-script-summary">
      <div className="fs-script-title">{script.title === 'Untitled script' ? t('Untitled script') : script.title}</div>
      <div className="fs-script-byline">{t('by')} {script.author === 'Unknown author' ? t('Unknown author') : script.author} <span>·</span> {script.source === 'Local library' ? t('Local library') : script.source}</div>
      <Waveform script={script} />
    </div>
    <div className="fs-metric"><span>{formatDuration(script.duration)}</span><small><LocalizedText text="Duration" /></small></div>
    <div className="fs-metric"><span>{script.actions ? script.actions.toLocaleString() : '—'}</span><small><LocalizedText text="Actions" /></small></div>
    <div className="fs-metric"><span>{formatSpeed(script.max_speed)}</span><small title={t('EroScripts-style normalized position speed')}>{t('Max Speed')}</small></div>
    <div className="fs-metric"><span>{formatSpeed(script.avg_speed)}</span><small title={t('EroScripts-style normalized position speed')}>{t('Avg Speed')}</small></div>
    <div className="fs-row-labels">
      <Badge tone={String(script.intensity).toLowerCase().includes('intense') ? 'danger' : String(script.intensity).toLowerCase().includes('high') ? 'pink' : 'amber'}>{t(script.intensity)}</Badge>
      <Badge tone="focus">{t(script.focus)}</Badge>
      {script.axes.map(axis => <Badge key={axis}>{axis}</Badge>)}
      {(script.multi_axis || script.axes.length > 1) && <Badge tone="device"><Activity size={12} /> <LocalizedText text="Multi-axis" /></Badge>}
      {script.tags.slice(0, 2).map(tag => <Badge key={tag} tone="tag">{tag}</Badge>)}
    </div>
    <span className="fs-last-played">{script.last_played_label ? t(script.last_played_label) : t(script.last_played ? 'Recently' : 'Never')}</span>
    <button className="fs-more" onClick={e => { e.stopPropagation(); onRemove ? onRemove(script) : onAddTag(script) }} title={t(onRemove ? 'Remove from playlist' : 'Add manual tag')}>{onRemove ? <Trash2 size={17} /> : <Tag size={17} />}</button>
    {tagTarget?.id === script.id && <div className="fs-row-inline-anchor" onClick={event => event.stopPropagation()}><InlineTagEditor script={script} draft={tagDraft} setDraft={setTagDraft} onSubmit={submitTag} onClose={closeTag} availableTags={availableTags} /></div>}
  </div>
}

function Inspector({ script, onPlay, onFavorite, onAddTag, onRemoveTag, onAddPlaylist, playlistChooserScript, playlists, onAddToPlaylist, onClosePlaylist, tagTarget, tagDraft, setTagDraft, submitTag, closeTag, availableTags, onRate, navigate }) {
  const t = useT()
  if (!script) return <aside className="fs-inspector fs-empty-inspector"><Sparkles size={28} /><h3><LocalizedText text="Select a script" /></h3><p><LocalizedText text="Waveform details, tags, ratings and the independent player live here." /></p></aside>
  return <aside className="fs-inspector">
    <div className="fs-inspector-head"><div><h2>{script.title === 'Untitled script' ? t('Untitled script') : script.title}</h2><p>{t('by')} {script.author === 'Unknown author' ? t('Unknown author') : script.author} · {script.source === 'Local library' ? t('Local library') : script.source}</p></div><button className={`fs-heart ${script.favorite ? 'is-favorite' : ''}`} onClick={() => onFavorite(script)} aria-label={t(script.favorite ? 'Remove favorite' : 'Favorite script')}><Heart size={22} fill={script.favorite ? 'currentColor' : 'none'} /></button></div>
    <Waveform script={script} large />
    <div className="fs-wave-times"><span>00:00</span><span>{formatDuration(script.duration)}</span></div>
    <div className="fs-inspector-tags">{(script.manualTags || script.tags).map(tag => { const name = typeof tag === 'string' ? tag : tag.name; return <button type="button" key={name} className="fs-manual-tag" onClick={() => onRemoveTag(script, tag)}>{name}<X size={12} /></button> })}<button type="button" className="fs-add-tag" onClick={() => onAddTag(script)}><Plus size={13} /> <LocalizedText text="Add tag" /></button></div>
    {tagTarget?.id === script.id && <InlineTagEditor script={script} draft={tagDraft} setDraft={setTagDraft} onSubmit={submitTag} onClose={closeTag} availableTags={availableTags} />}
    <div className="fs-rating-row"><RatingControl value={script.rating} onChange={onRate} /><span className="fs-muted">{script.axes.join(' + ')}</span></div>
    <div className="fs-inspector-actions"><button type="button" className="fs-primary-action" onClick={() => onPlay(script)}><Play size={17} fill="currentColor" /> <LocalizedText text="Play script" /></button><div className="fs-playlist-action"><button type="button" className="fs-secondary-action" onClick={() => onAddPlaylist(script)}><Plus size={17} /> <LocalizedText text="Add to playlist" /></button>{playlistChooserScript?.id === script.id && <InlinePlaylistChooser script={script} playlists={playlists} onAdd={onAddToPlaylist} onClose={onClosePlaylist} />}</div></div>
    <div className="fs-detail-grid"><div><small><LocalizedText text="Active time" /></small><strong>{script.active_time ? `${script.active_time}%` : '—'}</strong></div><div><small><LocalizedText text="Longest pause" /></small><strong>{script.longest_pause ? `${script.longest_pause}s` : '—'}</strong></div><div><small><LocalizedText text="Coverage" /></small><strong>{script.coverage ? `${script.coverage}%` : '—'}</strong></div><div><small title={t('EroScripts-style normalized position speed')}><LocalizedText text="Max speed" /></small><strong>{formatSpeed(script.max_speed)}</strong></div></div>
    <div className="fs-source-block"><label><LocalizedText text="Source video (optional)" /></label><SourceVideoLink script={script} navigate={navigate} /></div>
  </aside>
}

export default function Funscripts() {
  const t = useT()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [tab, setTab] = useState('all')
  const [search, setSearch] = useState('')
  const [tagSearch, setTagSearch] = useState('')
  const [sort, setSort] = useState('max_speed')
  const [sortDirection, setSortDirection] = useState('desc')
  const [filters, setFilters] = useState({})
  const [selected, setSelected] = useState(null)
  const [page, setPage] = useState(1)
  const [tagDraft, setTagDraft] = useState('')
  const [tagTarget, setTagTarget] = useState(null)
  const [selectedPlaylistId, setSelectedPlaylistId] = useState(null)
  const [playlistTarget, setPlaylistTarget] = useState(null)
  const [playlistChooserScript, setPlaylistChooserScript] = useState(null)
  const [playlistName, setPlaylistName] = useState('')
  const [showPlaylistForm, setShowPlaylistForm] = useState(false)
  const [draggingQueueIndex, setDraggingQueueIndex] = useState(null)
  const [queueDropIndex, setQueueDropIndex] = useState(null)

  const { data: scriptsData, isLoading, isError } = useQuery({
    queryKey: ['funscripts'],
    queryFn: async () => {
      const pageSize = 500
      const first = (await funscriptsApi.list({ limit: pageSize, skip: 0 })).data
      const total = Number(first?.total ?? unwrap(first).length)
      const items = [...unwrap(first)]
      for (let skip = pageSize; skip < total; skip += pageSize) {
        const next = (await funscriptsApi.list({ limit: pageSize, skip })).data
        items.push(...unwrap(next))
      }
      return { ...(first || {}), items, total }
    },
    staleTime: 30000,
  })
  const { data: playlistsData } = useQuery({ queryKey: ['funscript-playlists'], queryFn: () => funscriptsApi.playlists.list().then(r => r.data), staleTime: 30000 })
  const { data: playlistDetailData } = useQuery({ queryKey: ['funscript-playlist', selectedPlaylistId], queryFn: () => funscriptsApi.playlists.get(selectedPlaylistId).then(r => r.data), enabled: Boolean(selectedPlaylistId), staleTime: 30000 })
  const scripts = useMemo(() => unwrap(scriptsData).map(normalizeScript), [scriptsData])
  const playlists = useMemo(() => unwrap(playlistsData), [playlistsData])
  const playlistScripts = useMemo(() => sortScriptRecords(unwrap(playlistDetailData).map(normalizeScript), sort, sortDirection), [playlistDetailData, sort, sortDirection])
  const playerQueue = useFunscriptPlayerStore(s => s.queue)
  const clearPlayerQueue = useFunscriptPlayerStore(s => s.clearQueue)
  const removeFromPlayerQueue = useFunscriptPlayerStore(s => s.removeFromQueue)
  const moveInPlayerQueue = useFunscriptPlayerStore(s => s.moveInQueue)

  useEffect(() => {
    if (!selectedPlaylistId && playlists.length) setSelectedPlaylistId(playlists[0].id)
  }, [playlists, selectedPlaylistId])

  const syncSelected = response => {
    const record = response?.data ?? response
    if (record?.id != null) setSelected(current => current?.id === record.id ? normalizeScript(record) : current)
  }
  const favoriteMut = useMutation({ mutationFn: ({ script }) => funscriptsApi.favorite(script.id, !script.favorite), onSuccess: response => { syncSelected(response); qc.invalidateQueries({ queryKey: ['funscripts'] }); qc.invalidateQueries({ queryKey: ['funscript-playlist', selectedPlaylistId] }) }, onError: () => toast.error(t('Could not update favorite')) })
  const analyzeMut = useMutation({ mutationFn: () => funscriptsApi.analyze(), onSuccess: response => { const indexed = response?.data?.indexed ?? response?.indexed; toast.success(indexed != null ? t('Analysis complete · {count} indexed', { count: indexed }) : t('Repository analysis complete')); qc.invalidateQueries({ queryKey: ['funscripts'] }) }, onError: () => toast.error(t('Could not analyze repository')) })
  const addTagMut = useMutation({ mutationFn: ({ script, tag }) => funscriptsApi.addTag(script.id, tag), onSuccess: response => { syncSelected(response); setTagTarget(null); setTagDraft(''); qc.invalidateQueries({ queryKey: ['funscripts'] }); qc.invalidateQueries({ queryKey: ['funscript-playlist', selectedPlaylistId] }) }, onError: () => toast.error(t('Could not add tag')) })
  const removeTagMut = useMutation({ mutationFn: ({ script, tag }) => funscriptsApi.removeTag(script.id, tag?.id ?? tag), onSuccess: response => { syncSelected(response); qc.invalidateQueries({ queryKey: ['funscripts'] }); qc.invalidateQueries({ queryKey: ['funscript-playlist', selectedPlaylistId] }) }, onError: () => toast.error(t('Could not remove tag')) })
  const ratingMut = useMutation({ mutationFn: ({ script, rating }) => funscriptsApi.update(script.id, { rating }), onSuccess: response => { syncSelected(response); qc.invalidateQueries({ queryKey: ['funscripts'] }); qc.invalidateQueries({ queryKey: ['funscript-playlist', selectedPlaylistId] }) }, onError: () => toast.error(t('Could not update rating')) })
  const addToPlaylistMut = useMutation({ mutationFn: ({ playlistId, scriptId }) => funscriptsApi.playlists.addScript(playlistId, scriptId), onSuccess: () => { toast.success(t('Added to script playlist')); setPlaylistChooserScript(null); qc.invalidateQueries({ queryKey: ['funscript-playlists'] }); qc.invalidateQueries({ queryKey: ['funscript-playlist', selectedPlaylistId] }) }, onError: () => toast.error(t('Could not add to playlist')) })
  const removeFromPlaylistMut = useMutation({ mutationFn: ({ playlistId, scriptId }) => funscriptsApi.playlists.removeScript(playlistId, scriptId), onSuccess: () => { qc.invalidateQueries({ queryKey: ['funscript-playlists'] }); qc.invalidateQueries({ queryKey: ['funscript-playlist', selectedPlaylistId] }) }, onError: () => toast.error(t('Could not remove from playlist')) })
  const removeFromPlaylistMutate = values => removeFromPlaylistMut.mutate(values)
  const createPlaylistMut = useMutation({ mutationFn: () => funscriptsApi.playlists.create({ name: playlistName }), onSuccess: (response) => { setPlaylistName(''); setShowPlaylistForm(false); qc.invalidateQueries({ queryKey: ['funscript-playlists'] }); const created = response?.data || response; if (playlistTarget && created?.id) { addToPlaylistMut.mutate({ playlistId: created.id, scriptId: playlistTarget.id }); setPlaylistTarget(null) } }, onError: () => toast.error(t('Could not create playlist')) })
  const deletePlaylistMut = useMutation({
    mutationFn: playlistId => funscriptsApi.playlists.delete(playlistId),
    onSuccess: (_, deletedPlaylistId) => {
      const nextPlaylist = playlists.find(playlist => playlist.id !== deletedPlaylistId)
      if (selectedPlaylistId === deletedPlaylistId) {
        setSelectedPlaylistId(nextPlaylist?.id ?? null)
        if (!nextPlaylist) setTab('all')
      }
      qc.removeQueries({ queryKey: ['funscript-playlist', deletedPlaylistId] })
      qc.invalidateQueries({ queryKey: ['funscript-playlists'] })
      toast.success(t('Script playlist deleted'))
    },
    onError: () => toast.error(t('Could not delete script playlist')),
  })

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const tq = tagSearch.trim().toLowerCase()
    const matching = scripts.filter(s => {
      if (tab === 'favorites' && !s.favorite) return false
      if (tab === 'playlists') return false
      if (q && !`${s.title} ${s.author} ${s.source} ${s.tags.join(' ')}`.toLowerCase().includes(q)) return false
      if (tq && !s.tags.some(tag => String(tag).toLowerCase().includes(tq))) return false
      return Object.entries(filters).every(([key, value]) => {
        if (!value || value === FILTERS[key]?.[0]) return true
        if (key === 'speed') {
          const speed = Number(s.avg_speed || 0)
          return value === 'Slow' ? speed < 100 : value === 'Moderate' ? speed >= 100 && speed < 180 : value === 'Fast' ? speed >= 180 && speed < 280 : value === 'Very fast' ? speed >= 280 : false
        }
        if (key === 'axes') return value === 'Multi-axis' ? s.axes.length > 1 : s.axes.join(' + ') === value || s.axes.includes(value)
        if (key === 'compatibility') return (value === 'Vibrator compatible' && s.vibrator_compatible) || (value === 'Multi-axis compatible' && s.multi_axis)
        return String(s[key] || '').toLowerCase().includes(String(value).replace('All ', '').toLowerCase())
      })
    })
    return sortScriptRecords(matching, sort, sortDirection)
  }, [scripts, tab, search, tagSearch, filters, sort, sortDirection])

  const pageSize = 50
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const visibleScripts = filtered.slice((page - 1) * pageSize, page * pageSize)
  const filterKey = `${tab}|${search}|${tagSearch}|${sort}|${sortDirection}|${JSON.stringify(filters)}`
  useEffect(() => { setPage(1) }, [filterKey])
  useEffect(() => { if (page > pageCount) setPage(pageCount) }, [page, pageCount])

  const selectScript = useCallback(script => setSelected(script), [])
  const playScript = useCallback(script => { playbackBridge(script); setSelected(script) }, [])
  const addTag = useCallback(script => { setTagTarget(script); setTagDraft('') }, [])
  const submitTag = e => { e.preventDefault(); if (tagTarget && tagDraft.trim()) addTagMut.mutate({ script: tagTarget, tag: tagDraft.trim() }) }
  const closeTag = () => { setTagTarget(null); setTagDraft('') }
  const addPlaylist = script => {
    if (!playlists.length) { setShowPlaylistForm(true); setPlaylistTarget(script); return }
    setPlaylistChooserScript(script)
  }
  const deletePlaylist = playlist => {
    if (window.confirm(t('Delete "{name}"? This cannot be undone.', { name: playlist.name }))) deletePlaylistMut.mutate(playlist.id)
  }
  const changeSort = useCallback(nextKey => {
    setSortDirection(current => sort === nextKey
      ? (current === 'asc' ? 'desc' : 'asc')
      : (DEFAULT_SORT_DIRECTIONS[nextKey] || 'desc'))
    setSort(nextKey)
  }, [sort])
  const sortLabelMap = useMemo(() => Object.fromEntries(SORTS.map(([key, label]) => [key, key === sort ? `${label} ${sortDirection === 'asc' ? '↑' : '↓'}` : label])), [sort, sortDirection])
  useEffect(() => {
    const keys = ['title', 'duration', 'actions', 'max_speed', 'avg_speed', 'labels', 'last_played']
    const headers = document.querySelectorAll('.fs-page .fs-list-head')
    const cleanups = []
    headers.forEach(header => {
      Array.from(header.children).slice(2, -1).forEach((element, index) => {
        const key = keys[index]
        if (!key) return
        const activate = () => changeSort(key)
        const onKeyDown = event => {
          if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); activate() }
        }
        element.classList.add('fs-sort-heading')
        element.setAttribute('role', 'button')
        element.setAttribute('tabindex', '0')
        element.addEventListener('click', activate)
        element.addEventListener('keydown', onKeyDown)
        cleanups.push(() => {
          element.classList.remove('fs-sort-heading')
          element.removeAttribute('role')
          element.removeAttribute('tabindex')
          element.removeAttribute('data-sort-active')
          element.removeAttribute('data-sort-direction')
          element.removeAttribute('aria-label')
          element.removeAttribute('aria-sort')
          element.removeAttribute('title')
          element.removeEventListener('click', activate)
          element.removeEventListener('keydown', onKeyDown)
        })
      })
    })
    headers.forEach(header => Array.from(header.children).slice(2, -1).forEach((element, index) => {
      const key = keys[index]
      if (key !== sort) return
      const label = element.textContent.trim()
      element.dataset.sortActive = 'true'
      element.dataset.sortDirection = sortDirection
      element.setAttribute('aria-label', t('{label}, sorted {direction}. Click to reverse.', { label, direction: t(sortDirection === 'asc' ? 'ascending' : 'descending') }))
      element.setAttribute('aria-sort', sortDirection === 'asc' ? 'ascending' : 'descending')
      element.title = t('Sorted {direction} · click to reverse', { direction: t(sortDirection === 'asc' ? 'ascending' : 'descending') })
    }))
    return () => cleanups.forEach(cleanup => cleanup())
  }, [changeSort, sort, sortDirection, t])
  const headerCount = scriptsData?.total ?? scriptsData?.analyzed_count ?? scripts.length
  const analyzed = scriptsData?.analyzed_count ?? scripts.filter(s => s.health === 'Ready').length
  const apiHealthLabel = scriptsData?.health_label
  const healthCount = apiHealthLabel?.match(/^(\d+) analyzed$/)
  const healthLabel = healthCount
    ? t('{count} analyzed', { count: Number(healthCount[1]) })
    : t(apiHealthLabel || (scripts.length ? '{count} analyzed' : 'Waiting for repository analysis'), scripts.length ? { count: analyzed } : undefined)
  const noScriptsYet = !isLoading && !isError && scripts.length === 0
  const queueScripts = playerQueue.map(normalizeScript)
  const availableTags = useMemo(() => Array.from(new Set(scripts.flatMap(script => script.tags))).sort((a, b) => a.localeCompare(b)), [scripts])
  const dropQueueItem = (from, to) => {
    if (from !== to) moveInPlayerQueue(from, to)
    setDraggingQueueIndex(null)
    setQueueDropIndex(null)
  }

  return <div className="fs-page">
    <header className="fs-page-header"><div><h1><LocalizedText text="Funscripts" /></h1><p><LocalizedText text="Your script collection" /> <span>·</span> {t('{count} analyzed', { count: headerCount || 0 })}</p></div><div className="fs-header-actions"><button className="fs-analyze-button" onClick={() => analyzeMut.mutate()} disabled={analyzeMut.isPending}><RefreshCw size={17} className={analyzeMut.isPending ? 'fs-spin' : ''} /> {t(analyzeMut.isPending ? 'Analyzing…' : 'Analyze repository')}</button><span className="fs-health-pill"><i /> {t(healthLabel)}</span></div></header>
    <div className="fs-layout">
      <main className="fs-main">
        <section className="fs-toolbar"><div className="fs-toolbar-top"><label className="fs-search"><Search size={19} /><input value={search} onChange={e => setSearch(e.target.value)} placeholder={t('Search scripts…')} aria-label={t('Search scripts…')} /></label><label className="fs-search fs-tag-search"><Tag size={18} /><input value={tagSearch} onChange={e => setTagSearch(e.target.value)} placeholder={t('Search by tag…')} aria-label={t('Search by tag…')} /></label><div className="fs-tabs"><button className={tab === 'all' ? 'is-active' : ''} onClick={() => setTab('all')}><LocalizedText text="All scripts" /></button><button className={tab === 'favorites' ? 'is-active' : ''} onClick={() => setTab('favorites')}><Heart size={15} /> <LocalizedText text="Favorites" /></button><button className={tab === 'playlists' ? 'is-active' : ''} onClick={() => { setTab('playlists'); if (!selectedPlaylistId) setSelectedPlaylistId(playlists[0]?.id || null) }}><ListMusic size={15} /> <LocalizedText text="Playlists" /></button></div></div><div className="fs-filters"><SlidersHorizontal size={18} className="fs-filter-icon" />{Object.entries(FILTERS).map(([key, options]) => <DropdownSelect key={key} id={`filter-${key}`} value={filters[key] || options[0]} options={options} onChange={option => setFilters(current => ({ ...current, [key]: option }))} />)}<DropdownSelect id="sort-scripts" value={sort} options={SORTS.map(([value]) => value)} onChange={changeSort} prefix="Sort: " labelMap={sortLabelMap} /></div></section>
        {tab === 'playlists' ? <div className="fs-playlist-view"><div className="fs-playlist-view-head"><div><h2>{playlists.find(p => p.id === selectedPlaylistId)?.name || t('Script playlists')}</h2><p>{t('Independent from media playlists · {count} scripts', { count: playlistScripts.length })}</p></div><button onClick={() => setShowPlaylistForm(true)}><Plus size={16} /> <LocalizedText text="New playlist" /></button></div><div className="fs-list-head"><span /><span /><span>{t('Script')}</span><span>{t('Duration')}</span><span>{t('Actions')}</span><span>{t('Max Speed')}</span><span>{t('Avg Speed')}</span><span>{t('Labels')}</span><span>{t('Last played')}</span><span /></div>{playlistScripts.length ? playlistScripts.map(script => <ScriptRow key={script.id} script={script} selected={selected?.id === script.id} onSelect={selectScript} onPlay={playScript} onFavorite={script => favoriteMut.mutate({ script })} onAddTag={addTag} onRemove={script => removeFromPlaylistMutate({ playlistId: selectedPlaylistId, scriptId: script.id })} tagTarget={tagTarget} tagDraft={tagDraft} setTagDraft={setTagDraft} submitTag={submitTag} closeTag={closeTag} availableTags={availableTags} />) : <div className="fs-loading">{t(selectedPlaylistId ? 'This playlist is empty. Add scripts from the collection.' : 'Create a script playlist to organize independent sessions.')}</div>}</div> : <><div className="fs-list-head"><span /><span /><span>{t('Script')}</span><span>{t('Duration')}</span><span>{t('Actions')}</span><span>{t('Max Speed')}</span><span>{t('Avg Speed')}</span><span>{t('Labels')}</span><span>{t('Last played')}</span><span /></div><div className="fs-script-list">{isLoading ? <div className="fs-loading"><LoaderCircle className="fs-spin" /> <LocalizedText text="Loading scripts…" /></div> : isError ? <div className="fs-loading"><LocalizedText text="Could not load scripts. Try Analyze repository after checking Settings." /></div> : filtered.length ? visibleScripts.map(script => <ScriptRow key={script.id} script={script} selected={selected?.id === script.id} onSelect={selectScript} onPlay={playScript} onFavorite={script => favoriteMut.mutate({ script })} onAddTag={addTag} tagTarget={tagTarget} tagDraft={tagDraft} setTagDraft={setTagDraft} submitTag={submitTag} closeTag={closeTag} availableTags={availableTags} />) : <div className="fs-loading">{t(noScriptsYet ? 'No scripts are indexed yet. Use Analyze repository after configuring the repository in Settings.' : 'No scripts match these filters.')}</div>}</div>{filtered.length > 0 && <div className="fs-pagination"><button onClick={() => setPage(value => Math.max(1, value - 1))} disabled={page <= 1}><LocalizedText text="Previous" /></button><span>{t('Page {page} of {pages} · {start}–{end} of {count} scripts', { page, pages: pageCount, start: ((page - 1) * pageSize) + 1, end: Math.min(page * pageSize, filtered.length), count: filtered.length })}</span><button onClick={() => setPage(value => Math.min(pageCount, value + 1))} disabled={page >= pageCount}><LocalizedText text="Next" /></button></div>}</>}
      </main>
       <aside className="fs-playlists"><div className="fs-column-heading"><span><LocalizedText text="Script playlists" /></span><button title={t('Create script playlist')} aria-label={t('Create script playlist')} onClick={() => setShowPlaylistForm(v => !v)}><Plus size={17} /></button></div>{showPlaylistForm && <form className="fs-create-playlist" onSubmit={e => { e.preventDefault(); if (playlistName.trim()) createPlaylistMut.mutate() }}><input autoFocus value={playlistName} onChange={e => setPlaylistName(e.target.value)} placeholder={t('Playlist name')} aria-label={t('Playlist name')} /><button type="submit" aria-label={t('Create playlist')}><Check size={15} /></button></form>}{playlists.length ? playlists.map(p => <div key={p.id} className={`fs-playlist-item ${selectedPlaylistId === p.id ? 'is-active' : ''}`}><button type="button" className="fs-playlist-select" onClick={() => { setTab('playlists'); setSelectedPlaylistId(p.id) }}><ListMusic size={17} /><span>{p.name}</span><b>{p.script_count ?? p.items?.length ?? 0}</b></button><button type="button" className="fs-playlist-delete" title={t('Delete {name}', { name: p.name })} aria-label={t('Delete {name}', { name: p.name })} disabled={deletePlaylistMut.isPending} onClick={event => { event.stopPropagation(); deletePlaylist(p) }}><Trash2 size={15} /></button></div>) : <p className="fs-muted fs-playlist-note"><LocalizedText text="Make a script playlist for your favorite sessions." /></p>}<div className="fs-queue-preview"><div className="fs-column-heading"><span><LocalizedText text="Queue" /> <b>({queueScripts.length})</b></span><button onClick={clearPlayerQueue}><LocalizedText text="Clear" /></button></div><div className="fs-queue-list">{queueScripts.length ? queueScripts.map((item, index) => <QueueItem key={item.id || index} item={item} index={index} total={queueScripts.length} onPlay={playScript} onRemove={removeFromPlayerQueue} onMove={moveInPlayerQueue} draggingIndex={draggingQueueIndex} dropIndex={queueDropIndex} onDragStart={setDraggingQueueIndex} onDragOver={setQueueDropIndex} onDrop={dropQueueItem} onDragEnd={() => { setDraggingQueueIndex(null); setQueueDropIndex(null) }} />) : <p className="fs-muted"><LocalizedText text="Play a script to start your independent queue." /></p>}</div></div></aside>
      <Inspector script={selected} onPlay={playScript} onFavorite={script => favoriteMut.mutate({ script })} onAddTag={addTag} onRemoveTag={(script, tag) => removeTagMut.mutate({ script, tag })} onAddPlaylist={addPlaylist} playlistChooserScript={playlistChooserScript} playlists={playlists} onAddToPlaylist={(playlistId, scriptId) => addToPlaylistMut.mutate({ playlistId, scriptId })} onClosePlaylist={() => setPlaylistChooserScript(null)} tagTarget={tagTarget} tagDraft={tagDraft} setTagDraft={setTagDraft} submitTag={submitTag} closeTag={closeTag} availableTags={availableTags} onRate={rating => selected && ratingMut.mutate({ script: selected, rating })} navigate={navigate} />
    </div>
  </div>
}

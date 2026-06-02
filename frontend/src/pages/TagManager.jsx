import React, { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  Tag as TagIcon, Sparkles, Pencil, Trash2, GitMerge, X, Check,
  Search, ChevronDown, Flame, Eye, Star, Users, Crown, Activity,
  Zap, ArrowUpDown, Layers, List, Cloud, ChevronRight, Play, RefreshCw,
} from 'lucide-react'
import { tagsApi, imagesApi } from '../lib/api'

// ── Category config ───────────────────────────────────────────────────────────
const CAT_ICONS = {
  sex_act: Flame, body_part: Zap, physical_feature: Sparkles,
  nudity_level: Eye, position: ArrowUpDown, clothing: Layers,
  pose: Activity, rating: Star, subject: Users,
  character: Crown, style: Sparkles, general: TagIcon,
}

const CATS = [
  { key: 'all',              label: 'All',                 color: '#888' },
  { key: 'body_part',        label: 'Body Part',           color: '#E07B54' },
  { key: 'subject',          label: 'Subject',             color: '#9CA3AF' },
  { key: 'clothing',         label: 'Clothing',            color: '#1D9E75' },
  { key: 'physical_feature', label: 'Physical Appearance', color: '#378ADD' },
  { key: 'sex_act',          label: 'Sex Act',             color: '#D4537E' },
  { key: 'nudity_level',     label: 'Nudity',              color: '#BA7517' },
  { key: 'position',         label: 'Position',            color: '#9B59B6' },
  { key: 'pose',             label: 'Pose',                color: '#6B7280' },
  { key: 'rating',           label: 'Rating',              color: '#9CA3AF' },
  { key: 'character',        label: 'Character',           color: '#7F77DD' },
  { key: 'style',            label: 'Style',               color: '#4B9E6E' },
  { key: 'general',          label: 'General',             color: '#555' },
]
const CAT_MAP   = Object.fromEntries(CATS.map(c => [c.key, c]))
const catColor  = cat => CAT_MAP[cat]?.color ?? '#888'
const catIcon   = cat => CAT_ICONS[cat] ?? TagIcon
const thumbUrl  = path => path ? `/thumbs/${path.split(/[\\/]/).pop()}` : null

// ── Edit / merge modal ────────────────────────────────────────────────────────
function EditModal({ tag, allTags, onClose, onSaved }) {
  const qc = useQueryClient()
  const [name, setName]               = useState(tag.name)
  const [category, setCategory]       = useState(tag.category)
  const [mergeSearch, setMergeSearch] = useState('')
  const [mergeMode, setMergeMode]     = useState(false)
  const [mergeTarget, setMergeTarget] = useState(null)
  const [confirmDel, setConfirmDel]   = useState(false)

  const inv = () => { qc.invalidateQueries({ queryKey: ['tags'] }); onSaved() }
  const updateMut = useMutation({ mutationFn: () => tagsApi.update(tag.id, { name: name.trim(), category }), onSuccess: inv })
  const deleteMut = useMutation({ mutationFn: () => tagsApi.delete(tag.id), onSuccess: inv })
  const mergeMut  = useMutation({ mutationFn: () => tagsApi.merge(tag.id, mergeTarget.id), onSuccess: inv })

  const mergeOptions = useMemo(() =>
    allTags.filter(t => t.id !== tag.id && t.name.toLowerCase().includes(mergeSearch.toLowerCase())).slice(0, 8),
    [allTags, tag.id, mergeSearch])
  const dirty = name.trim() !== tag.name || category !== tag.category

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.75)' }}>
      <div className="w-[480px] rounded-2xl border border-[rgba(255,255,255,0.08)] p-6 flex flex-col gap-4" style={{ background: '#1a1a1a' }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full" style={{ background: catColor(tag.category) }} />
            <span className="text-[20px] font-semibold text-white truncate">{tag.name}</span>
            <span className="text-[17px] text-[rgba(255,255,255,0.3)]">· {tag.use_count} uses</span>
          </div>
          <button onClick={onClose} className="text-[rgba(255,255,255,0.3)] hover:text-white"><X size={18} /></button>
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-[17px] text-[rgba(255,255,255,0.4)]">Name</label>
          <input value={name} onChange={e => setName(e.target.value)}
            className="w-full px-3 py-2 rounded-lg text-[18px] text-white border border-[rgba(255,255,255,0.1)] outline-none focus:border-[rgba(127,119,221,0.6)]"
            style={{ background: '#111' }} />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-[17px] text-[rgba(255,255,255,0.4)]">Category</label>
          <div className="relative">
            <select value={category} onChange={e => setCategory(e.target.value)}
              className="w-full px-3 py-2 rounded-lg text-[18px] text-white border border-[rgba(255,255,255,0.1)] outline-none appearance-none focus:border-[rgba(127,119,221,0.6)]"
              style={{ background: '#111' }}>
              {CATS.filter(c => c.key !== 'all').map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
            <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-[rgba(255,255,255,0.3)] pointer-events-none" />
          </div>
        </div>
        <button onClick={() => updateMut.mutate()} disabled={!dirty || !name.trim() || updateMut.isPending}
          className="w-full py-2.5 rounded-lg text-[18px] font-medium transition-all disabled:opacity-30"
          style={{ background: dirty && name.trim() ? '#7F77DD' : 'rgba(127,119,221,0.2)', color: '#fff' }}>
          {updateMut.isPending ? 'Saving…' : 'Save Changes'}
        </button>
        <div className="border-t border-[rgba(255,255,255,0.06)]" />
        {!mergeMode ? (
          <button onClick={() => setMergeMode(true)} className="flex items-center gap-2 text-[17px] text-[rgba(255,255,255,0.4)] hover:text-[rgba(255,255,255,0.75)] transition-colors">
            <GitMerge size={16} /> Merge this tag into another…
          </button>
        ) : (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-[17px] text-[rgba(255,255,255,0.5)] flex items-center gap-2"><GitMerge size={16} /> Merge "{tag.name}" into:</span>
              <button onClick={() => { setMergeMode(false); setMergeTarget(null); setMergeSearch('') }} className="text-[rgba(255,255,255,0.3)] hover:text-white text-[17px]">cancel</button>
            </div>
            <input value={mergeSearch} onChange={e => { setMergeSearch(e.target.value); setMergeTarget(null) }}
              placeholder="Search tags…"
              className="w-full px-3 py-2 rounded-lg text-[18px] text-white border border-[rgba(255,255,255,0.1)] outline-none focus:border-[rgba(127,119,221,0.6)]"
              style={{ background: '#111' }} />
            {mergeSearch && (
              <div className="rounded-lg border border-[rgba(255,255,255,0.08)] overflow-hidden" style={{ background: '#111' }}>
                {mergeOptions.length === 0
                  ? <div className="px-3 py-2 text-[17px] text-[rgba(255,255,255,0.3)]">No matches</div>
                  : mergeOptions.map(t => (
                    <button key={t.id} onClick={() => { setMergeTarget(t); setMergeSearch(t.name) }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-[17px] text-left hover:bg-[rgba(255,255,255,0.05)]"
                      style={{ color: mergeTarget?.id === t.id ? '#7F77DD' : 'rgba(255,255,255,0.75)' }}>
                      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: catColor(t.category) }} />
                      {t.name}
                      <span className="ml-auto text-[rgba(255,255,255,0.3)]">{t.use_count}</span>
                      {mergeTarget?.id === t.id && <Check size={14} className="text-[#7F77DD]" />}
                    </button>
                  ))}
              </div>
            )}
            {mergeTarget && (
              <button onClick={() => mergeMut.mutate()} disabled={mergeMut.isPending}
                className="w-full py-2.5 rounded-lg text-[18px] font-medium text-white" style={{ background: '#D4537E' }}>
                {mergeMut.isPending ? 'Merging…' : `Merge into "${mergeTarget.name}" — source deleted`}
              </button>
            )}
          </div>
        )}
        {!confirmDel ? (
          <button onClick={() => setConfirmDel(true)} className="flex items-center gap-2 text-[17px] text-[rgba(255,255,255,0.3)] hover:text-[#D4537E] transition-colors">
            <Trash2 size={16} /> Delete tag ({tag.use_count} image{tag.use_count !== 1 ? 's' : ''} affected)
          </button>
        ) : (
          <div className="flex gap-2">
            <button onClick={() => deleteMut.mutate()} disabled={deleteMut.isPending}
              className="flex-1 py-2 rounded-lg text-[18px] font-medium text-white" style={{ background: '#D4537E' }}>
              {deleteMut.isPending ? 'Deleting…' : 'Yes, delete'}
            </button>
            <button onClick={() => setConfirmDel(false)}
              className="flex-1 py-2 rounded-lg text-[18px] text-[rgba(255,255,255,0.5)] border border-[rgba(255,255,255,0.1)]">
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Tag chip with inline count bar ────────────────────────────────────────────
function TagChip({ tag, maxCount, onView, onEdit }) {
  const color = catColor(tag.category)
  const pct   = maxCount > 0 ? Math.round((tag.use_count / maxCount) * 100) : 0
  return (
    <button
      onClick={() => onView(tag)}
      className="group relative flex items-center gap-2 px-3 py-1.5 rounded-full border transition-all overflow-hidden hover:border-[rgba(255,255,255,0.25)]"
      style={{ borderColor: 'rgba(255,255,255,0.08)',
               background: `linear-gradient(90deg, ${color}18 ${pct}%, rgba(255,255,255,0.03) ${pct}%)` }}
    >
      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: color }} />
      <span className="text-[17px] text-[rgba(255,255,255,0.85)]">{tag.name}</span>
      <span className="text-[14px] font-medium tabular-nums" style={{ color: `${color}cc` }}>{tag.use_count}</span>
      {tag.source === 'ai' && <Sparkles size={11} className="opacity-0 group-hover:opacity-60 transition-opacity" style={{ color }} />}
      <button onClick={e => { e.stopPropagation(); onEdit(tag) }}
        className="opacity-0 group-hover:opacity-100 transition-opacity ml-0.5"
        title="Edit tag">
        <Pencil size={11} className="text-[rgba(255,255,255,0.4)] hover:text-white" />
      </button>
    </button>
  )
}

// ── Tag cloud ─────────────────────────────────────────────────────────────────
function TagCloud({ tags, onView }) {
  const counts = tags.map(t => t.use_count)
  const min    = Math.min(...counts) || 1
  const max    = Math.max(...counts) || 1
  const size   = count => 14 + Math.round(((count - min) / (max - min || 1)) * 34)

  return (
    <div className="flex flex-wrap gap-3 p-4 justify-center items-center">
      {tags.map(tag => {
        const color = catColor(tag.category)
        const fs    = size(tag.use_count)
        return (
          <button key={tag.id} onClick={() => onView(tag)}
            className="transition-all hover:scale-110 active:scale-95"
            style={{ fontSize: fs, color, opacity: 0.6 + (tag.use_count / max) * 0.4,
                     textShadow: `0 0 20px ${color}44`, fontWeight: fs > 28 ? 700 : 500,
                     lineHeight: 1.2 }}>
            {tag.name}
          </button>
        )
      })}
    </div>
  )
}

// ── Image panel (slides in from right) ───────────────────────────────────────
function ImagePanel({ tag, allTags, onClose }) {
  const navigate  = useNavigate()
  const qc        = useQueryClient()
  const [offset, setOffset]   = useState(0)
  const [editOpen, setEditOpen] = useState(false)
  const LIMIT = 48

  const { data, isFetching } = useQuery({
    queryKey: ['tag-images', tag.id, offset],
    queryFn:  () => tagsApi.images(tag.id, { limit: LIMIT, offset }).then(r => r.data),
    keepPreviousData: true,
  })

  const removeMut = useMutation({
    mutationFn: (imageId) => imagesApi.removeTag(imageId, tag.name),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tag-images', tag.id] })
      qc.invalidateQueries({ queryKey: ['tags'] })
    },
  })

  const color   = catColor(tag.category)
  const CatIcon = catIcon(tag.category)
  const total   = data?.total ?? 0
  const items   = data?.items ?? []

  return (
    <div className="flex flex-col h-full border-l border-[rgba(255,255,255,0.07)]" style={{ background: '#111' }}>
      {/* Panel header */}
      <div className="flex-shrink-0 px-4 pt-4 pb-3 border-b border-[rgba(255,255,255,0.07)]"
           style={{ background: `linear-gradient(135deg, ${color}18, transparent)` }}>
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: `${color}22` }}>
              <CatIcon size={16} style={{ color }} />
            </div>
            <div className="min-w-0">
              <div className="text-[20px] font-bold text-white truncate">{tag.name}</div>
              <div className="text-[15px]" style={{ color: `${color}cc` }}>
                {CAT_MAP[tag.category]?.label ?? tag.category} · {total.toLocaleString()} images
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <button onClick={() => setEditOpen(true)} title="Edit tag"
              className="w-8 h-8 rounded-lg flex items-center justify-center text-[rgba(255,255,255,0.4)] hover:text-white hover:bg-[rgba(255,255,255,0.07)] transition-all">
              <Pencil size={15} />
            </button>
            <button onClick={onClose}
              className="w-8 h-8 rounded-lg flex items-center justify-center text-[rgba(255,255,255,0.4)] hover:text-white hover:bg-[rgba(255,255,255,0.07)] transition-all">
              <X size={15} />
            </button>
          </div>
        </div>
        {tag.source === 'ai' && (
          <div className="flex items-center gap-1 text-[14px] text-[rgba(127,119,221,0.7)]">
            <Sparkles size={12} /> AI generated · hover images to remove wrong tags
          </div>
        )}
      </div>

      {/* Image grid */}
      <div className="flex-1 overflow-y-auto p-3" style={{ scrollbarWidth: 'thin' }}>
        {items.length === 0 && !isFetching ? (
          <div className="flex flex-col items-center justify-center h-32 text-[rgba(255,255,255,0.2)] text-[17px]">
            No images yet
          </div>
        ) : (
          <div className="grid gap-1.5" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
            {items.map(img => (
              <div key={img.id} className="group relative aspect-square rounded-lg overflow-hidden bg-[rgba(255,255,255,0.05)]">
                {/* Main click → gallery */}
                <button onClick={() => navigate(`/galleries/${img.gallery_id}`)}
                  className="absolute inset-0 w-full h-full"
                  title={img.confidence ? `${Math.round(img.confidence * 100)}% confidence` : ''}>
                  {img.thumb_path ? (
                    <img src={thumbUrl(img.thumb_path)} alt=""
                      className="w-full h-full object-cover transition-transform group-hover:scale-105" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-[rgba(255,255,255,0.1)]">
                      <TagIcon size={20} />
                    </div>
                  )}
                </button>

                {img.is_video && (
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <Play size={16} className="text-white opacity-80" />
                  </div>
                )}
                {img.confidence && (
                  <div className="absolute bottom-1 right-1 px-1 py-0.5 rounded text-[11px] font-medium opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"
                       style={{ background: `${color}cc`, color: '#fff' }}>
                    {Math.round(img.confidence * 100)}%
                  </div>
                )}
                {img.cum_count > 0 && (
                  <div className="absolute bottom-1 left-1 px-1 py-0.5 rounded text-[11px] font-medium pointer-events-none"
                       style={{ background: 'rgba(212,83,126,0.85)', color: '#fff' }}>
                    {img.cum_count}
                  </div>
                )}
                {/* Remove tag from this image */}
                <button
                  onClick={e => { e.stopPropagation(); removeMut.mutate(img.id) }}
                  disabled={removeMut.isPending}
                  title="Remove this tag from image"
                  className="absolute top-1 right-1 w-5 h-5 rounded flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-10"
                  style={{ background: 'rgba(212,83,126,0.85)' }}>
                  <X size={10} className="text-white" />
                </button>
              </div>
            ))}
          </div>
        )}
        {isFetching && <div className="text-center py-4 text-[rgba(255,255,255,0.3)] text-[17px]">Loading…</div>}

        {/* Pagination */}
        {total > LIMIT && (
          <div className="flex items-center justify-center gap-3 mt-4">
            <button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - LIMIT))}
              className="px-4 py-1.5 rounded-lg text-[17px] disabled:opacity-30 text-[rgba(255,255,255,0.6)] hover:text-white border border-[rgba(255,255,255,0.1)] hover:border-[rgba(255,255,255,0.2)] transition-all">
              ←
            </button>
            <span className="text-[16px] text-[rgba(255,255,255,0.4)]">
              {offset + 1}–{Math.min(offset + LIMIT, total)} of {total}
            </span>
            <button disabled={offset + LIMIT >= total} onClick={() => setOffset(offset + LIMIT)}
              className="px-4 py-1.5 rounded-lg text-[17px] disabled:opacity-30 text-[rgba(255,255,255,0.6)] hover:text-white border border-[rgba(255,255,255,0.1)] hover:border-[rgba(255,255,255,0.2)] transition-all">
              →
            </button>
          </div>
        )}
      </div>

      {editOpen && (
        <EditModal tag={tag} allTags={allTags} onClose={() => setEditOpen(false)} onSaved={() => { setEditOpen(false); onClose() }} />
      )}
    </div>
  )
}

// ── Category overview card ────────────────────────────────────────────────────
function CategoryCard({ cat, topTags, imageCount, samples, onSelect, onTagView }) {
  const CatIcon = catIcon(cat.key)
  const imgs    = samples?.[cat.key] ?? []

  return (
    <div className="rounded-2xl overflow-hidden border border-[rgba(255,255,255,0.07)] cursor-pointer group transition-all hover:border-[rgba(255,255,255,0.15)] hover:scale-[1.01]"
         style={{ background: '#161616' }} onClick={() => onSelect(cat.key)}>
      {/* Colored header */}
      <div className="px-4 py-3 flex items-center gap-3"
           style={{ background: `linear-gradient(135deg, ${cat.color}28, ${cat.color}10)`,
                    borderBottom: `1px solid ${cat.color}22` }}>
        <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
             style={{ background: `${cat.color}22` }}>
          <CatIcon size={18} style={{ color: cat.color }} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[18px] font-bold" style={{ color: cat.color }}>{cat.label}</div>
          <div className="text-[15px] text-[rgba(255,255,255,0.35)]">
            {topTags.length} tags · {imageCount.toLocaleString()} images
          </div>
        </div>
        <ChevronRight size={16} className="text-[rgba(255,255,255,0.2)] group-hover:text-[rgba(255,255,255,0.5)] transition-colors flex-shrink-0" />
      </div>

      {/* Image strip */}
      {imgs.length > 0 && (
        <div className="flex gap-0.5 h-[90px] overflow-hidden">
          {imgs.map(img => (
            <div key={img.id} className="flex-1 min-w-0 overflow-hidden">
              <img src={thumbUrl(img.thumb_path)} alt=""
                   className="w-full h-full object-cover transition-transform group-hover:scale-105" />
            </div>
          ))}
        </div>
      )}

      {/* Top tags */}
      {topTags.length > 0 && (
        <div className="px-4 py-3 flex flex-wrap gap-1.5">
          {topTags.slice(0, 8).map(tag => (
            <button key={tag.id}
              onClick={e => { e.stopPropagation(); onTagView(tag) }}
              className="px-2.5 py-1 rounded-full text-[14px] font-medium transition-all hover:scale-105"
              style={{ background: `${cat.color}18`, color: `${cat.color}cc`,
                       border: `1px solid ${cat.color}25` }}>
              {tag.name}
              <span className="ml-1 opacity-60">{tag.use_count}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function TagManager() {
  const [selectedCat, setSelectedCat] = useState('all')
  const [search, setSearch]           = useState('')
  const [viewMode, setViewMode]       = useState('list')  // 'list' | 'cloud'
  const [activeTag, setActiveTag]     = useState(null)    // tag whose images are shown
  const [editTag, setEditTag]         = useState(null)    // tag being edited

  const qc = useQueryClient()
  const { data: tags = [] }   = useQuery({ queryKey: ['tags'],           queryFn: () => tagsApi.list().then(r => r.data) })
  const { data: stats }       = useQuery({ queryKey: ['tag-stats'],      queryFn: () => tagsApi.stats().then(r => r.data) })
  const { data: samples }     = useQuery({ queryKey: ['cat-samples'],    queryFn: () => tagsApi.categorySamples().then(r => r.data) })

  const recalcMut = useMutation({
    mutationFn: tagsApi.recalculate,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tags'] })
      qc.invalidateQueries({ queryKey: ['tag-stats'] })
      qc.invalidateQueries({ queryKey: ['tag-images'] })
      qc.invalidateQueries({ queryKey: ['cat-samples'] })
    },
  })

  const activeCats = CATS  // always show all categories for organization

  const filtered = useMemo(() => {
    let list = tags
    if (selectedCat !== 'all') list = list.filter(t => t.category === selectedCat)
    if (search.trim()) list = list.filter(t => t.name.toLowerCase().includes(search.toLowerCase()))
    return list
  }, [tags, selectedCat, search])

  const maxCount = useMemo(() => Math.max(...filtered.map(t => t.use_count), 1), [filtered])

  // Group by category for list views
  const grouped = useMemo(() => {
    if (selectedCat !== 'all') return null
    const g = {}
    filtered.forEach(t => { if (!g[t.category]) g[t.category] = []; g[t.category].push(t) })
    return g
  }, [filtered, selectedCat])

  // Show overview cards: All tab, no search, list mode
  const showOverview = selectedCat === 'all' && !search.trim() && viewMode !== 'cloud'

  const handleTagView = (tag) => { setActiveTag(tag) }
  const handleTagEdit = (tag) => { setEditTag(tag) }

  return (
    <div className="flex h-full overflow-hidden" style={{ background: '#0e0e0e' }}>
      {/* ── Left: main content ── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-8 pt-7 pb-4 flex-shrink-0">
          <div>
            <h1 className="text-[28px] font-bold text-white">Tag Manager</h1>
            {stats && (
              <p className="text-[17px] text-[rgba(255,255,255,0.4)] mt-0.5">
                {stats.total_tags.toLocaleString()} tags · {stats.total_tagged_images.toLocaleString()} tagged images
              </p>
            )}
          </div>
          <div className="flex items-center gap-3">
            {/* Sync counts */}
            <button onClick={() => recalcMut.mutate()} disabled={recalcMut.isPending}
              title="Recalculate tag counts from actual image data"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[15px] transition-all disabled:opacity-50"
              style={{ background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.4)', border: '1px solid rgba(255,255,255,0.08)' }}>
              <RefreshCw size={13} className={recalcMut.isPending ? 'animate-spin' : ''} />
              {recalcMut.isPending ? 'Syncing…' : 'Sync counts'}
            </button>
            {/* View mode toggle */}
            <div className="flex rounded-xl overflow-hidden border border-[rgba(255,255,255,0.08)]">
              {[{ k: 'list', Icon: List }, { k: 'cloud', Icon: Cloud }].map(({ k, Icon }) => (
                <button key={k} onClick={() => setViewMode(k)}
                  className="px-3 py-2 transition-all"
                  style={{ background: viewMode === k ? 'rgba(127,119,221,0.25)' : 'transparent',
                           color: viewMode === k ? '#CECBF6' : 'rgba(255,255,255,0.35)' }}>
                  <Icon size={16} />
                </button>
              ))}
            </div>
            {/* Search */}
            <div className="relative">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[rgba(255,255,255,0.3)]" />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search tags…"
                className="pl-9 pr-8 py-2 rounded-xl text-[17px] text-white border border-[rgba(255,255,255,0.08)] outline-none focus:border-[rgba(127,119,221,0.4)] w-56"
                style={{ background: '#1a1a1a' }} />
              {search && (
                <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[rgba(255,255,255,0.3)] hover:text-white">
                  <X size={13} />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Category tabs */}
        <div className="flex gap-1.5 px-8 pb-4 flex-shrink-0 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
          {activeCats.map(c => {
            const count  = c.key === 'all' ? tags.length : (stats?.by_category?.[c.key] ?? 0)
            const active = selectedCat === c.key
            const CIcon  = catIcon(c.key)
            return (
              <button key={c.key} onClick={() => setSelectedCat(c.key)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[16px] font-medium whitespace-nowrap transition-all flex-shrink-0"
                style={{ background: active ? `${c.color}22` : 'rgba(255,255,255,0.04)',
                         color: active ? c.color : 'rgba(255,255,255,0.4)',
                         border: `1px solid ${active ? c.color + '44' : 'rgba(255,255,255,0.07)'}` }}>
                {c.key !== 'all' && <CIcon size={13} />}
                {c.label}
                <span className="opacity-60 text-[14px]">{count}</span>
              </button>
            )
          })}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-8 pb-8">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 text-[rgba(255,255,255,0.2)]">
              <TagIcon size={32} className="mb-3 opacity-40" />
              <span className="text-[18px]">No tags found</span>
            </div>

          ) : viewMode === 'cloud' ? (
            <TagCloud tags={filtered} onView={handleTagView} />

          ) : showOverview ? (
            // ── Category overview cards ──
            <div className="grid grid-cols-2 gap-4 pb-4" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
              {activeCats.filter(c => c.key !== 'all').map(cat => {
                const catTags = tags.filter(t => t.category === cat.key)
                const imgCount = catTags.reduce((s, t) => s + t.use_count, 0)
                return (
                  <CategoryCard key={cat.key} cat={cat}
                    topTags={catTags.slice(0, 8)}
                    imageCount={imgCount}
                    samples={samples}
                    onSelect={k => { setSelectedCat(k); setViewMode('list') }}
                    onTagView={handleTagView} />
                )
              })}
            </div>

          ) : grouped ? (
            // ── All tab with search: grouped chip list ──
            Object.entries(grouped)
              .sort(([a], [b]) => CATS.findIndex(c => c.key === a) - CATS.findIndex(c => c.key === b))
              .map(([cat, catTags]) => {
                const cfg  = CAT_MAP[cat] || { label: cat, color: '#888' }
                const CIcon = catIcon(cat)
                const max  = Math.max(...catTags.map(t => t.use_count), 1)
                return (
                  <div key={cat} className="mb-7">
                    <div className="flex items-center gap-2 mb-3">
                      <CIcon size={14} style={{ color: cfg.color }} />
                      <span className="text-[16px] font-bold uppercase tracking-wide" style={{ color: cfg.color }}>{cfg.label}</span>
                      <span className="text-[16px] text-[rgba(255,255,255,0.2)]">· {catTags.length}</span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {catTags.map(tag => (
                        <TagChip key={tag.id} tag={tag} maxCount={max} onView={handleTagView} onEdit={handleTagEdit} />
                      ))}
                    </div>
                  </div>
                )
              })

          ) : (
            // ── Single category flat chip list ──
            <div className="flex flex-wrap gap-2 pt-2">
              {filtered.map(tag => (
                <TagChip key={tag.id} tag={tag} maxCount={maxCount} onView={handleTagView} onEdit={handleTagEdit} />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Right: image panel ── */}
      {activeTag && (
        <div className="w-[570px] min-w-[570px] flex flex-col overflow-hidden">
          <ImagePanel tag={activeTag} allTags={tags} onClose={() => setActiveTag(null)} />
        </div>
      )}

      {/* Edit modal */}
      {editTag && (
        <EditModal tag={editTag} allTags={tags}
          onClose={() => setEditTag(null)}
          onSaved={() => setEditTag(null)} />
      )}
    </div>
  )
}

import React, { useState, useMemo, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Tag as TagIcon, Sparkles, Pencil, Trash2, GitMerge, X, Check,
  Search, ChevronDown, Flame, Eye, Star, Users, Crown, Activity,
  Zap, ArrowUpDown, Layers, List, Cloud, ChevronRight, Play,
  Settings, RotateCcw, Download,
} from 'lucide-react'
import { tagsApi, imagesApi, tagVocabApi } from '../lib/api'

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

// Theme-aware helpers — these read the live --accent/--c-* custom properties
// (see store/vault.js applyPalette) instead of hardcoding the default palette's hex.
const ACCENT       = 'var(--accent)'
const ACCENT_TEXT  = 'color-mix(in srgb, var(--accent) 70%, white)'
const accentTint   = (pct) => `color-mix(in srgb, var(--accent) ${pct}%, transparent)`
const pinkTint     = (pct) => `color-mix(in srgb, var(--c-pink) ${pct}%, transparent)`

// Shared modal motion presets
const backdropAnim = {
  initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 },
  transition: { duration: 0.18 },
}
const panelAnim = {
  initial: { opacity: 0, y: 16, scale: 0.97 },
  animate: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, y: 10, scale: 0.98 },
  transition: { duration: 0.22, ease: [0.16, 1, 0.3, 1] },
}

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
    <motion.div {...backdropAnim} onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)' }}>
      <motion.div {...panelAnim} onClick={e => e.stopPropagation()}
        className="w-[480px] rounded-2xl border border-[rgba(255,255,255,0.08)] p-6 flex flex-col gap-4"
        style={{ background: 'var(--c-card)' }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full" style={{ background: catColor(tag.category) }} />
            <span className="text-[20px] font-semibold text-white truncate">{tag.name}</span>
            <span className="text-[17px] text-[rgba(255,255,255,0.3)]">· {tag.use_count} uses</span>
          </div>
          <motion.button whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }}
            onClick={onClose} className="text-[rgba(255,255,255,0.3)] hover:text-white"><X size={18} /></motion.button>
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-[17px] text-[rgba(255,255,255,0.4)]">Name</label>
          <input value={name} onChange={e => setName(e.target.value)}
            className="w-full px-3 py-2 rounded-lg text-[18px] text-white border border-[rgba(255,255,255,0.1)] outline-none transition-colors"
            style={{ background: 'var(--c-surface)' }}
            onFocus={e => e.target.style.borderColor = accentTint(60)}
            onBlur={e => e.target.style.borderColor = 'rgba(255,255,255,0.1)'} />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-[17px] text-[rgba(255,255,255,0.4)]">Category</label>
          <div className="relative">
            <select value={category} onChange={e => setCategory(e.target.value)}
              className="w-full px-3 py-2 rounded-lg text-[18px] text-white border border-[rgba(255,255,255,0.1)] outline-none appearance-none transition-colors"
              style={{ background: 'var(--c-surface)' }}
              onFocus={e => e.target.style.borderColor = accentTint(60)}
              onBlur={e => e.target.style.borderColor = 'rgba(255,255,255,0.1)'}>
              {CATS.filter(c => c.key !== 'all').map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
            <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-[rgba(255,255,255,0.3)] pointer-events-none" />
          </div>
        </div>
        <motion.button whileTap={{ scale: 0.98 }} onClick={() => updateMut.mutate()} disabled={!dirty || !name.trim() || updateMut.isPending}
          className="w-full py-2.5 rounded-lg text-[18px] font-medium transition-all disabled:opacity-30"
          style={{ background: dirty && name.trim() ? ACCENT : accentTint(20), color: '#fff' }}>
          {updateMut.isPending ? 'Saving…' : 'Save Changes'}
        </motion.button>
        <div className="border-t border-[rgba(255,255,255,0.06)]" />
        {!mergeMode ? (
          <button onClick={() => setMergeMode(true)} className="flex items-center gap-2 text-[17px] text-[rgba(255,255,255,0.4)] hover:text-[rgba(255,255,255,0.75)] transition-colors">
            <GitMerge size={16} /> Merge this tag into another…
          </button>
        ) : (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="flex flex-col gap-2 overflow-hidden">
            <div className="flex items-center justify-between">
              <span className="text-[17px] text-[rgba(255,255,255,0.5)] flex items-center gap-2"><GitMerge size={16} /> Merge "{tag.name}" into:</span>
              <button onClick={() => { setMergeMode(false); setMergeTarget(null); setMergeSearch('') }} className="text-[rgba(255,255,255,0.3)] hover:text-white text-[17px]">cancel</button>
            </div>
            <input value={mergeSearch} onChange={e => { setMergeSearch(e.target.value); setMergeTarget(null) }}
              placeholder="Search tags…"
              className="w-full px-3 py-2 rounded-lg text-[18px] text-white border border-[rgba(255,255,255,0.1)] outline-none transition-colors"
              style={{ background: 'var(--c-surface)' }}
              onFocus={e => e.target.style.borderColor = accentTint(60)}
              onBlur={e => e.target.style.borderColor = 'rgba(255,255,255,0.1)'} />
            <AnimatePresence>
              {mergeSearch && (
                <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                  className="rounded-lg border border-[rgba(255,255,255,0.08)] overflow-hidden" style={{ background: 'var(--c-surface)' }}>
                  {mergeOptions.length === 0
                    ? <div className="px-3 py-2 text-[17px] text-[rgba(255,255,255,0.3)]">No matches</div>
                    : mergeOptions.map(t => (
                      <button key={t.id} onClick={() => { setMergeTarget(t); setMergeSearch(t.name) }}
                        className="w-full flex items-center gap-2 px-3 py-2 text-[17px] text-left hover:bg-[rgba(255,255,255,0.05)] transition-colors"
                        style={{ color: mergeTarget?.id === t.id ? ACCENT_TEXT : 'rgba(255,255,255,0.75)' }}>
                        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: catColor(t.category) }} />
                        {t.name}
                        <span className="ml-auto text-[rgba(255,255,255,0.3)]">{t.use_count}</span>
                        {mergeTarget?.id === t.id && <Check size={14} style={{ color: ACCENT }} />}
                      </button>
                    ))}
                </motion.div>
              )}
            </AnimatePresence>
            <AnimatePresence>
              {mergeTarget && (
                <motion.button initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => mergeMut.mutate()} disabled={mergeMut.isPending}
                  className="w-full py-2.5 rounded-lg text-[18px] font-medium text-white" style={{ background: 'var(--c-pink)' }}>
                  {mergeMut.isPending ? 'Merging…' : `Merge into "${mergeTarget.name}" — source deleted`}
                </motion.button>
              )}
            </AnimatePresence>
          </motion.div>
        )}
        {!confirmDel ? (
          <button onClick={() => setConfirmDel(true)} className="flex items-center gap-2 text-[17px] text-[rgba(255,255,255,0.3)] hover:text-[var(--c-pink)] transition-colors">
            <Trash2 size={16} /> Delete tag ({tag.use_count} image{tag.use_count !== 1 ? 's' : ''} affected)
          </button>
        ) : (
          <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className="flex gap-2">
            <motion.button whileTap={{ scale: 0.98 }} onClick={() => deleteMut.mutate()} disabled={deleteMut.isPending}
              className="flex-1 py-2 rounded-lg text-[18px] font-medium text-white" style={{ background: 'var(--c-pink)' }}>
              {deleteMut.isPending ? 'Deleting…' : 'Yes, delete'}
            </motion.button>
            <button onClick={() => setConfirmDel(false)}
              className="flex-1 py-2 rounded-lg text-[18px] text-[rgba(255,255,255,0.5)] border border-[rgba(255,255,255,0.1)]">
              Cancel
            </button>
          </motion.div>
        )}
      </motion.div>
    </motion.div>
  )
}

// ── AI Tagging Settings modal — browse & toggle the raw model vocabulary ───────
const PAGE_SIZE = 100

function AiTaggingSettingsModal({ onClose }) {
  const qc = useQueryClient()
  const [model, setModel]           = useState('wd14')
  const [search, setSearch]         = useState('')
  const [debounced, setDebounced]   = useState('')
  const [category, setCategory]     = useState('')
  const [page, setPage]             = useState(1)
  const [selected, setSelected]     = useState(() => new Set())
  const [editRow, setEditRow]       = useState(null) // vocab entry being renamed/recategorized

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300)
    return () => clearTimeout(t)
  }, [search])

  useEffect(() => { setPage(1); setSelected(new Set()) }, [model, debounced, category])

  const { data: summary } = useQuery({
    queryKey: ['tag-vocab-summary', model],
    queryFn: () => tagVocabApi.summary(model).then(r => r.data),
  })

  const { data: list, isLoading } = useQuery({
    queryKey: ['tag-vocab-list', model, debounced, category, page],
    queryFn: () => tagVocabApi.list({
      model, search: debounced || undefined, category: category || undefined,
      page, page_size: PAGE_SIZE,
    }).then(r => r.data),
    enabled: !!summary?.model_ready,
    keepPreviousData: true,
  })

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['tag-vocab-list'] })
    qc.invalidateQueries({ queryKey: ['tag-vocab-summary'] })
  }

  const toggleMut = useMutation({
    mutationFn: ({ id, enabled }) => tagVocabApi.update(id, { enabled }),
    onSuccess: invalidate,
  })
  const bulkMut = useMutation({
    mutationFn: ({ ids, enabled }) => tagVocabApi.bulkUpdate(ids, enabled),
    onSuccess: () => { invalidate(); setSelected(new Set()) },
  })
  const resetMut = useMutation({
    mutationFn: () => tagVocabApi.resetDefaults(model),
    onSuccess: invalidate,
  })
  const editMut = useMutation({
    mutationFn: ({ id, normalized_name, category }) => tagVocabApi.update(id, { normalized_name, category }),
    onSuccess: () => { invalidate(); setEditRow(null) },
  })

  const items      = list?.items ?? []
  const total      = list?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const toggleSelect = (id) => setSelected(s => {
    const next = new Set(s)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })
  const selectAllOnPage = () => setSelected(new Set(items.map(i => i.id)))
  const clearSelection  = () => setSelected(new Set())

  return (
    <motion.div {...backdropAnim} onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)' }}>
      <motion.div {...panelAnim} onClick={e => e.stopPropagation()}
        className="w-[820px] max-h-[85vh] rounded-2xl border border-[rgba(255,255,255,0.08)] flex flex-col"
        style={{ background: 'var(--c-card)' }}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-4 flex-shrink-0 border-b border-[rgba(255,255,255,0.06)]">
          <div className="flex items-center gap-2">
            <Settings size={18} style={{ color: ACCENT }} />
            <span className="text-[20px] font-semibold text-white">AI Tagging Settings</span>
          </div>
          <motion.button whileHover={{ scale: 1.1, rotate: 90 }} whileTap={{ scale: 0.9 }}
            onClick={onClose} className="text-[rgba(255,255,255,0.3)] hover:text-white"><X size={18} /></motion.button>
        </div>

        {/* Model tabs + summary */}
        <div className="flex items-center justify-between px-6 pt-4 flex-shrink-0">
          <div className="relative flex rounded-xl overflow-hidden border border-[rgba(255,255,255,0.08)]">
            {[{ k: 'wd14', label: 'WD14' }, { k: 'joytag', label: 'JoyTag' }].map(({ k, label }) => (
              <button key={k} onClick={() => setModel(k)}
                className="relative px-4 py-2 text-[16px] font-medium transition-colors z-10"
                style={{ color: model === k ? ACCENT_TEXT : 'rgba(255,255,255,0.4)' }}>
                {model === k && (
                  <motion.div layoutId="model-tab-bg" className="absolute inset-0 -z-10"
                    style={{ background: accentTint(25) }}
                    transition={{ type: 'spring', stiffness: 500, damping: 35 }} />
                )}
                {label}
              </button>
            ))}
          </div>
          <AnimatePresence mode="wait">
            {summary?.model_ready && (
              <motion.span key={`${model}-${summary.enabled}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="text-[16px] text-[rgba(255,255,255,0.4)]">
                {summary.enabled.toLocaleString()} / {summary.total.toLocaleString()} tags enabled
              </motion.span>
            )}
          </AnimatePresence>
        </div>

        <AnimatePresence mode="wait">
          {!summary?.model_ready ? (
            <motion.div key="not-ready" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="flex-1 flex flex-col items-center justify-center gap-3 py-16 text-[rgba(255,255,255,0.3)]">
              <Download size={28} className="opacity-40" />
              <span className="text-[18px]">{model === 'wd14' ? 'WD14' : 'JoyTag'} isn't downloaded yet</span>
              <span className="text-[16px] text-[rgba(255,255,255,0.25)]">Download it from Settings → AI Tagging first</span>
            </motion.div>
          ) : (
            <motion.div key="ready" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="flex flex-col flex-1 min-h-0">
              {/* Search + category filter */}
              <div className="flex items-center gap-3 px-6 pt-4 flex-shrink-0">
                <div className="relative flex-1">
                  <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[rgba(255,255,255,0.3)]" />
                  <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search raw tags…"
                    className="w-full pl-9 pr-8 py-2 rounded-xl text-[17px] text-white border border-[rgba(255,255,255,0.08)] outline-none transition-colors"
                    style={{ background: 'var(--c-surface)' }}
                    onFocus={e => e.target.style.borderColor = accentTint(40)}
                    onBlur={e => e.target.style.borderColor = 'rgba(255,255,255,0.08)'} />
                  {search && (
                    <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[rgba(255,255,255,0.3)] hover:text-white">
                      <X size={13} />
                    </button>
                  )}
                </div>
                <div className="relative">
                  <select value={category} onChange={e => setCategory(e.target.value)}
                    className="pl-3 pr-8 py-2 rounded-xl text-[16px] text-white border border-[rgba(255,255,255,0.08)] outline-none appearance-none"
                    style={{ background: 'var(--c-surface)' }}>
                    <option value="">All categories</option>
                    {CATS.filter(c => c.key !== 'all').map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
                  </select>
                  <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[rgba(255,255,255,0.3)] pointer-events-none" />
                </div>
                <motion.button whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.96 }}
                  onClick={() => resetMut.mutate()} disabled={resetMut.isPending}
                  title="Reset this model's tags to the shipped defaults"
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-[16px] transition-colors disabled:opacity-50 flex-shrink-0"
                  style={{ background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.4)', border: '1px solid rgba(255,255,255,0.08)' }}>
                  <motion.span animate={resetMut.isPending ? { rotate: 360 } : { rotate: 0 }}
                    transition={resetMut.isPending ? { repeat: Infinity, duration: 0.7, ease: 'linear' } : {}}>
                    <RotateCcw size={13} />
                  </motion.span>
                  Reset to defaults
                </motion.button>
              </div>

              {/* Bulk action bar */}
              <AnimatePresence>
                {selected.size > 0 && (
                  <motion.div
                    initial={{ opacity: 0, height: 0, marginTop: 0 }}
                    animate={{ opacity: 1, height: 'auto', marginTop: 12 }}
                    exit={{ opacity: 0, height: 0, marginTop: 0 }}
                    transition={{ duration: 0.18 }}
                    className="flex items-center gap-3 mx-6 px-3 py-2 rounded-xl flex-shrink-0 overflow-hidden"
                    style={{ background: accentTint(12), border: `1px solid ${accentTint(30)}` }}>
                    <span className="text-[16px] whitespace-nowrap" style={{ color: ACCENT_TEXT }}>{selected.size} selected</span>
                    <button onClick={() => bulkMut.mutate({ ids: [...selected], enabled: true })}
                      className="text-[16px] text-[rgba(255,255,255,0.75)] hover:text-white transition-colors">Enable</button>
                    <button onClick={() => bulkMut.mutate({ ids: [...selected], enabled: false })}
                      className="text-[16px] text-[rgba(255,255,255,0.75)] hover:text-white transition-colors">Disable</button>
                    <button onClick={clearSelection} className="ml-auto text-[16px] text-[rgba(255,255,255,0.3)] hover:text-white transition-colors">Clear</button>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* List */}
              <div className="flex-1 overflow-y-auto px-6 py-3 min-h-0">
                {isLoading ? (
                  <div className="flex items-center justify-center h-32 text-[rgba(255,255,255,0.3)] text-[17px]">Loading…</div>
                ) : items.length === 0 ? (
                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                    className="flex items-center justify-center h-32 text-[rgba(255,255,255,0.2)] text-[17px]">No tags found</motion.div>
                ) : (
                  <div className="flex flex-col gap-1">
                    <button onClick={selectAllOnPage} className="self-start text-[15px] text-[rgba(255,255,255,0.3)] hover:text-white transition-colors mb-1">
                      Select all on page
                    </button>
                    {items.map((entry, i) => (
                      <motion.div key={entry.id}
                        initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.16, delay: Math.min(i, 24) * 0.012 }}
                        className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-[rgba(255,255,255,0.03)] transition-colors">
                        <input type="checkbox" checked={selected.has(entry.id)} onChange={() => toggleSelect(entry.id)}
                          className="w-4 h-4 flex-shrink-0" style={{ accentColor: 'var(--accent)' }} />
                        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: catColor(entry.category) }} />
                        {editRow === entry.id ? (
                          <VocabEditRow entry={entry}
                            onCancel={() => setEditRow(null)}
                            onSave={(d) => editMut.mutate({ id: entry.id, ...d })} />
                        ) : (
                          <>
                            <span className="flex-1 min-w-0 text-[16px] text-[rgba(255,255,255,0.4)] truncate font-mono">{entry.raw_tag}</span>
                            <ChevronRight size={12} className="text-[rgba(255,255,255,0.2)] flex-shrink-0" />
                            <span className="flex-1 min-w-0 text-[17px] text-white truncate">{entry.normalized_name}</span>
                            {entry.is_builtin_default && (
                              <span className="text-[13px] px-1.5 py-0.5 rounded flex-shrink-0" style={{ background: accentTint(15), color: ACCENT_TEXT }}>default</span>
                            )}
                            <button onClick={() => setEditRow(entry.id)} className="flex-shrink-0 text-[rgba(255,255,255,0.25)] hover:text-white transition-colors">
                              <Pencil size={13} />
                            </button>
                            <motion.button whileTap={{ scale: 0.9 }}
                              onClick={() => toggleMut.mutate({ id: entry.id, enabled: !entry.enabled })}
                              className="flex-shrink-0 w-10 h-5.5 rounded-full relative"
                              animate={{ background: entry.enabled ? ACCENT : 'rgba(255,255,255,0.12)' }}
                              style={{ background: entry.enabled ? ACCENT : 'rgba(255,255,255,0.12)' }}
                              transition={{ duration: 0.15 }}>
                              <motion.span className="absolute top-0.5 w-4 h-4 rounded-full bg-white"
                                animate={{ left: entry.enabled ? 22 : 2 }}
                                transition={{ type: 'spring', stiffness: 600, damping: 32 }} />
                            </motion.button>
                          </>
                        )}
                      </motion.div>
                    ))}
                  </div>
                )}
              </div>

              {/* Pagination */}
              <div className="flex items-center justify-between px-6 py-3 flex-shrink-0 border-t border-[rgba(255,255,255,0.06)]">
                <span className="text-[15px] text-[rgba(255,255,255,0.3)]">{total.toLocaleString()} raw tags</span>
                <div className="flex items-center gap-3">
                  <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}
                    className="text-[16px] text-[rgba(255,255,255,0.5)] hover:text-white transition-colors disabled:opacity-25">Prev</button>
                  <AnimatePresence mode="wait">
                    <motion.span key={page} initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 4 }}
                      transition={{ duration: 0.12 }}
                      className="text-[16px] text-[rgba(255,255,255,0.4)]">{page} / {totalPages}</motion.span>
                  </AnimatePresence>
                  <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}
                    className="text-[16px] text-[rgba(255,255,255,0.5)] hover:text-white transition-colors disabled:opacity-25">Next</button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </motion.div>
  )
}

function VocabEditRow({ entry, onCancel, onSave }) {
  const [name, setName]         = useState(entry.normalized_name)
  const [category, setCategory] = useState(entry.category)
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex-1 flex items-center gap-2">
      <input value={name} onChange={e => setName(e.target.value)} autoFocus
        className="flex-1 min-w-0 px-2 py-1 rounded text-[16px] text-white border border-[rgba(255,255,255,0.15)] outline-none"
        style={{ background: 'var(--c-surface)' }} />
      <select value={category} onChange={e => setCategory(e.target.value)}
        className="px-2 py-1 rounded text-[15px] text-white border border-[rgba(255,255,255,0.15)] outline-none"
        style={{ background: 'var(--c-surface)' }}>
        {CATS.filter(c => c.key !== 'all').map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
      </select>
      <button onClick={() => onSave({ normalized_name: name.trim(), category })} disabled={!name.trim()}
        className="transition-colors disabled:opacity-30" style={{ color: ACCENT }}><Check size={16} /></button>
      <button onClick={onCancel} className="text-[rgba(255,255,255,0.3)] hover:text-white transition-colors"><X size={16} /></button>
    </motion.div>
  )
}

// ── Tag chip with inline count bar ────────────────────────────────────────────
function TagChip({ tag, maxCount, onView, onEdit }) {
  const color = catColor(tag.category)
  const pct   = maxCount > 0 ? Math.round((tag.use_count / maxCount) * 100) : 0
  return (
    <motion.button
      layout
      whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
      onClick={() => onView(tag)}
      className="group relative flex items-center gap-2 px-3 py-1.5 rounded-full border overflow-hidden hover:border-[rgba(255,255,255,0.25)] transition-colors"
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
    </motion.button>
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
      {tags.map((tag, i) => {
        const color = catColor(tag.category)
        const fs    = size(tag.use_count)
        return (
          <motion.button key={tag.id} onClick={() => onView(tag)}
            initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 0.6 + (tag.use_count / max) * 0.4, scale: 1 }}
            transition={{ duration: 0.2, delay: Math.min(i, 40) * 0.008 }}
            whileHover={{ scale: 1.12 }} whileTap={{ scale: 0.95 }}
            style={{ fontSize: fs, color,
                     textShadow: `0 0 20px ${color}44`, fontWeight: fs > 28 ? 700 : 500,
                     lineHeight: 1.2 }}>
            {tag.name}
          </motion.button>
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
    <div className="flex flex-col h-full border-l border-[rgba(255,255,255,0.07)]" style={{ background: 'var(--c-surface)' }}>
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
          <div className="flex items-center gap-1 text-[14px]" style={{ color: accentTint(70) }}>
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
            {items.map((img, i) => (
              <motion.div key={img.id}
                initial={{ opacity: 0, scale: 0.94 }} animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.15, delay: Math.min(i, 30) * 0.01 }}
                className="group relative aspect-square rounded-lg overflow-hidden bg-[rgba(255,255,255,0.05)]">
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
                       style={{ background: pinkTint(85), color: '#fff' }}>
                    {img.cum_count}
                  </div>
                )}
                {/* Remove tag from this image */}
                <button
                  onClick={e => { e.stopPropagation(); removeMut.mutate(img.id) }}
                  disabled={removeMut.isPending}
                  title="Remove this tag from image"
                  className="absolute top-1 right-1 w-5 h-5 rounded flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-10"
                  style={{ background: pinkTint(85) }}>
                  <X size={10} className="text-white" />
                </button>
              </motion.div>
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

      <AnimatePresence>
        {editOpen && (
          <EditModal tag={tag} allTags={allTags} onClose={() => setEditOpen(false)} onSaved={() => { setEditOpen(false); onClose() }} />
        )}
      </AnimatePresence>
    </div>
  )
}

// ── Category overview card ────────────────────────────────────────────────────
function CategoryCard({ cat, topTags, imageCount, samples, onSelect, onTagView }) {
  const CatIcon = catIcon(cat.key)
  const imgs    = samples?.[cat.key] ?? []

  return (
    <motion.div whileHover={{ scale: 1.01, y: -2 }} whileTap={{ scale: 0.995 }}
      className="rounded-2xl overflow-hidden border border-[rgba(255,255,255,0.07)] cursor-pointer group transition-colors hover:border-[rgba(255,255,255,0.15)]"
      style={{ background: 'var(--c-surface)' }} onClick={() => onSelect(cat.key)}>
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
    </motion.div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function TagManager() {
  const [selectedCat, setSelectedCat] = useState('all')
  const [search, setSearch]           = useState('')
  const [viewMode, setViewMode]       = useState('list')  // 'list' | 'cloud'
  const [activeTag, setActiveTag]     = useState(null)    // tag whose images are shown
  const [editTag, setEditTag]         = useState(null)    // tag being edited
  const [showAiSettings, setShowAiSettings] = useState(false)

  const qc = useQueryClient()
  const { data: tags = [] }   = useQuery({ queryKey: ['tags'],           queryFn: () => tagsApi.list().then(r => r.data) })
  const { data: stats }       = useQuery({ queryKey: ['tag-stats'],      queryFn: () => tagsApi.stats().then(r => r.data) })
  const { data: samples }     = useQuery({ queryKey: ['cat-samples'],    queryFn: () => tagsApi.categorySamples().then(r => r.data) })

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
    <div className="flex h-full overflow-hidden" style={{ background: 'var(--c-bg)' }}>
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
            {/* AI Tagging Settings */}
            <motion.button whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.96 }}
              onClick={() => setShowAiSettings(true)}
              title="Choose which raw AI-model tags get applied"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[15px] transition-colors"
              style={{ background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.4)', border: '1px solid rgba(255,255,255,0.08)' }}>
              <Settings size={13} />
              AI Tagging Settings
            </motion.button>
            {/* View mode toggle */}
            <div className="relative flex rounded-xl overflow-hidden border border-[rgba(255,255,255,0.08)]">
              {[{ k: 'list', Icon: List }, { k: 'cloud', Icon: Cloud }].map(({ k, Icon }) => (
                <button key={k} onClick={() => setViewMode(k)}
                  className="relative px-3 py-2 transition-colors z-10"
                  style={{ color: viewMode === k ? ACCENT_TEXT : 'rgba(255,255,255,0.35)' }}>
                  {viewMode === k && (
                    <motion.div layoutId="viewmode-bg" className="absolute inset-0 -z-10"
                      style={{ background: accentTint(25) }}
                      transition={{ type: 'spring', stiffness: 500, damping: 35 }} />
                  )}
                  <Icon size={16} />
                </button>
              ))}
            </div>
            {/* Search */}
            <div className="relative">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[rgba(255,255,255,0.3)]" />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search tags…"
                className="pl-9 pr-8 py-2 rounded-xl text-[17px] text-white border border-[rgba(255,255,255,0.08)] outline-none w-56 transition-colors"
                style={{ background: 'var(--c-card)' }}
                onFocus={e => e.target.style.borderColor = accentTint(40)}
                onBlur={e => e.target.style.borderColor = 'rgba(255,255,255,0.08)'} />
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
              <motion.button key={c.key} whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }}
                onClick={() => setSelectedCat(c.key)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[16px] font-medium whitespace-nowrap transition-colors flex-shrink-0"
                style={{ background: active ? `${c.color}22` : 'rgba(255,255,255,0.04)',
                         color: active ? c.color : 'rgba(255,255,255,0.4)',
                         border: `1px solid ${active ? c.color + '44' : 'rgba(255,255,255,0.07)'}` }}>
                {c.key !== 'all' && <CIcon size={13} />}
                {c.label}
                <span className="opacity-60 text-[14px]">{count}</span>
              </motion.button>
            )
          })}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-8 pb-8">
          <AnimatePresence mode="wait">
            {filtered.length === 0 ? (
              <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="flex flex-col items-center justify-center h-48 text-[rgba(255,255,255,0.2)]">
                <TagIcon size={32} className="mb-3 opacity-40" />
                <span className="text-[18px]">No tags found</span>
              </motion.div>

            ) : viewMode === 'cloud' ? (
              <motion.div key="cloud" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <TagCloud tags={filtered} onView={handleTagView} />
              </motion.div>

            ) : showOverview ? (
              // ── Category overview cards ──
              <motion.div key="overview" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="grid grid-cols-2 gap-4 pb-4" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
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
              </motion.div>

            ) : grouped ? (
              // ── All tab with search: grouped chip list ──
              <motion.div key="grouped" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                {Object.entries(grouped)
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
                  })}
              </motion.div>

            ) : (
              // ── Single category flat chip list ──
              <motion.div key="flat" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="flex flex-wrap gap-2 pt-2">
                {filtered.map(tag => (
                  <TagChip key={tag.id} tag={tag} maxCount={maxCount} onView={handleTagView} onEdit={handleTagEdit} />
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* ── Right: image panel ── */}
      <AnimatePresence>
        {activeTag && (
          <motion.div
            initial={{ width: 0, opacity: 0 }} animate={{ width: 570, opacity: 1 }} exit={{ width: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="min-w-0 flex flex-col overflow-hidden">
            <ImagePanel tag={activeTag} allTags={tags} onClose={() => setActiveTag(null)} />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Edit modal */}
      <AnimatePresence>
        {editTag && (
          <EditModal tag={editTag} allTags={tags}
            onClose={() => setEditTag(null)}
            onSaved={() => setEditTag(null)} />
        )}
      </AnimatePresence>

      {/* AI Tagging Settings modal */}
      <AnimatePresence>
        {showAiSettings && (
          <AiTaggingSettingsModal onClose={() => setShowAiSettings(false)} />
        )}
      </AnimatePresence>
    </div>
  )
}

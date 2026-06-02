import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { dedupApi, imagesApi, tasksApi } from '../lib/api'
import {
  ScanLine, Trash2, CheckCircle, XCircle, ChevronDown, ChevronUp,
  AlertTriangle, Info, Clock, ExternalLink, EyeOff, Search,
  ChevronLeft, ChevronRight, X, User, FolderOpen, Infinity, ArrowUpCircle,
  Layers,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'

const PAGE_SIZE = 25

// ── Custom animated dropdown ───────────────────────────────────────────────────

function FilterDropdown({ icon: Icon, placeholder, value, options, onChange, onClear }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const selected = options.find(o => o.value === value)

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition w-full"
        style={{
          background: 'rgba(255,255,255,0.05)',
          borderColor: open ? 'rgba(127,119,221,0.5)' : 'rgba(255,255,255,0.1)',
          color: value ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.35)',
        }}
      >
        {Icon && <Icon size={13} className="flex-shrink-0" style={{ color: value ? '#7F77DD' : 'rgba(255,255,255,0.3)' }} />}
        <span className="flex-1 text-left truncate">{selected ? selected.label : placeholder}</span>
        {value ? (
          <X size={12} className="flex-shrink-0 hover:text-white/80 transition"
             style={{ color: 'rgba(255,255,255,0.35)' }}
             onClick={e => { e.stopPropagation(); onClear(); setOpen(false) }} />
        ) : (
          <ChevronDown size={12} className="flex-shrink-0 transition-transform duration-200"
                       style={{ color: 'rgba(255,255,255,0.3)', transform: open ? 'rotate(180deg)' : 'rotate(0deg)' }} />
        )}
      </button>

      <div className="absolute left-0 top-full mt-1 z-50 rounded-xl border overflow-hidden"
           style={{
             background: '#1e1e1e', borderColor: 'rgba(255,255,255,0.12)',
             minWidth: '100%', maxWidth: 260,
             maxHeight: open ? 260 : 0, opacity: open ? 1 : 0,
             pointerEvents: open ? 'auto' : 'none',
             transition: 'max-height 0.2s ease, opacity 0.15s ease',
             overflowY: 'auto', boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
           }}>
        <button type="button" onClick={() => { onClear(); setOpen(false) }}
                className="w-full text-left px-3 py-2 text-sm transition"
                style={{ color: !value ? '#7F77DD' : 'rgba(255,255,255,0.5)', background: !value ? 'rgba(127,119,221,0.1)' : 'transparent' }}>
          All
        </button>
        {options.map(opt => (
          <button key={opt.value} type="button" onClick={() => { onChange(opt.value); setOpen(false) }}
                  className="w-full text-left px-3 py-2 text-sm truncate transition"
                  style={{ color: opt.value === value ? '#7F77DD' : 'rgba(255,255,255,0.75)', background: opt.value === value ? 'rgba(127,119,221,0.1)' : 'transparent' }}>
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  )
}

// ── Hash progress (compact for left panel) ─────────────────────────────────────

function HashProgress({ status, taskState, stats, onStart, onCancel, isPending }) {
  const dedupTask = taskState
    ? [...(taskState.queued ?? []), taskState.current].find(t => t?.type === 'dedup_hash')
    : null
  const isQueued  = dedupTask?.status === 'queued'
  const isRunning = status?.running || dedupTask?.status === 'running'
  const runProgress = dedupTask?.progress ?? status?.progress ?? 0
  const runTotal    = dedupTask?.total    ?? status?.total    ?? 0
  const pct = runTotal > 0 ? Math.round((runProgress / runTotal) * 100) : 0

  return (
    <div className="rounded-xl border border-white/10 p-4" style={{ background: 'rgba(255,255,255,0.03)' }}>
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm font-semibold text-white/75">Hash Index</p>
        {isQueued && <span className="text-xs text-vault-accent/60 animate-pulse">Queued…</span>}
      </div>
      {isRunning ? (
        <button onClick={onCancel}
                className="w-full px-3 py-2 rounded-lg bg-white/10 hover:bg-white/15 text-white/60 text-sm font-medium transition mb-2">
          Cancel Hashing
        </button>
      ) : !isQueued ? (
        <button onClick={onStart} disabled={isPending}
                className="w-full px-3 py-2 rounded-lg font-semibold text-sm transition disabled:opacity-60 flex items-center justify-center gap-2 mb-2"
                style={{ background: '#7F77DD', color: '#fff' }}>
          <ScanLine size={14} className={isPending ? 'animate-spin' : ''} />
          {isPending ? 'Queuing…' : 'Build Index'}
        </button>
      ) : null}

      {isRunning && (
        <>
          <div className="w-full h-1.5 bg-white/10 rounded-full overflow-hidden mb-1">
            <div className="h-full bg-vault-accent transition-all duration-300"
                 style={{ width: pct > 0 ? `${pct}%` : '30%', opacity: pct > 0 ? 1 : 0.4 }} />
          </div>
          <p className="text-xs text-white/40">{dedupTask?.message || 'Hashing…'} {pct > 0 && `${pct}%`}</p>
        </>
      )}
      {!isRunning && stats && (
        <p className="text-xs text-white/35">
          {stats.hashed?.toLocaleString()} / {stats.total?.toLocaleString()} hashed
        </p>
      )}
    </div>
  )
}

// ── Image card inside a group ──────────────────────────────────────────────────

function ImageCard({ img, isKeep, onToggle }) {
  const thumb = img.thumb_path ? `/thumbs/${img.thumb_path.split(/[\\/]/).pop()}` : null
  return (
    <div className="relative rounded-lg border overflow-hidden cursor-pointer transition-all"
         style={{
           borderColor: isKeep ? '#1D9E75' : 'rgba(255,255,255,0.1)',
           boxShadow:   isKeep ? '0 0 0 2px rgba(29,158,117,0.35)' : 'none',
         }}
         onClick={onToggle}>
      {thumb
        ? <img src={thumb} alt={img.filename} className="w-full aspect-square object-cover" />
        : <div className="w-full aspect-square bg-white/5 flex items-center justify-center text-white/30 text-xs">No thumb</div>
      }
      <div className="p-2" style={{ background: 'var(--c-surface, #161616)' }}>
        <p className="text-white/80 text-xs truncate">{img.filename}</p>
        <p className="text-white/40 text-[11px] truncate">{img.gallery_name || 'No gallery'}</p>
        {img.creator_name && <p className="text-vault-accent/60 text-[11px] truncate">{img.creator_name}</p>}
        <div className="flex gap-2 mt-1 text-[11px] text-white/40">
          {img.width && img.height && <span>{img.width}×{img.height}</span>}
          {img.file_size && <span>{(img.file_size / 1024 / 1024).toFixed(1)} MB</span>}
          {img.rating > 0 && <span className="text-vault-amber">★ {img.rating}</span>}
          {img.cum_count > 0 && <span className="text-vault-pink">♥ {img.cum_count}</span>}
        </div>
      </div>
      <div className={`absolute top-2 right-2 rounded-full p-1 ${isKeep ? 'bg-vault-green' : 'bg-red-500/80'}`}>
        {isKeep ? <CheckCircle size={13} className="text-white" /> : <XCircle size={13} className="text-white" />}
      </div>
    </div>
  )
}

// ── Single duplicate group ─────────────────────────────────────────────────────

function DuplicateGroup({ group, onDeleteImage, onIgnore, onKeepBoth, onKeepChange }) {
  const initKeep = () => {
    const best = [...group.images].sort((a, b) => {
      const s = x => (x.rating || 0) * 10 + (x.cum_count || 0) + ((x.width || 0) * (x.height || 0)) / 1e6
      return s(b) - s(a)
    })
    return best[0]?.id
  }

  const [expanded, setExpanded]         = useState(true)
  const [keepId, setKeepId]             = useState(initKeep)
  const [deleting, setDeleting]         = useState(false)
  const [deleted, setDeleted]           = useState(new Set())
  const [confirmOpen, setConfirmOpen]   = useState(false)
  const [pendingIds, setPendingIds]     = useState([])
  const [keepBothBusy, setKeepBothBusy] = useState(false)

  const toDelete  = group.images.filter(img => img.id !== keepId && !deleted.has(img.id))
  const remaining = group.images.filter(img => !deleted.has(img.id))
  const upscaleFactor = detectUpscale(remaining)

  // Notify parent of keep selection (for bulk delete)
  const onKeepChangeRef = useRef(onKeepChange)
  onKeepChangeRef.current = onKeepChange
  useEffect(() => { onKeepChangeRef.current?.(keepId) }, [keepId])

  function handleToggleKeep(id) {
    setKeepId(id)
  }

  function openConfirm() {
    const ids = toDelete.map(img => img.id)
    if (ids.length === 0) return
    setPendingIds(ids)
    setConfirmOpen(true)
  }

  async function handleDeleteDupes() {
    const idsToDelete = pendingIds
    setConfirmOpen(false)
    if (idsToDelete.length === 0) return
    setDeleted(prev => new Set([...prev, ...idsToDelete]))
    setDeleting(true)
    try {
      await imagesApi.bulkDelete(idsToDelete)
      toast.success(`Deleted ${idsToDelete.length} duplicate${idsToDelete.length !== 1 ? 's' : ''}`)
      onDeleteImage(idsToDelete)
    } catch (e) {
      console.error('Bulk delete failed', e)
      toast.error('Delete failed — please try again')
      setDeleted(prev => {
        const n = new Set(prev)
        idsToDelete.forEach(id => n.delete(id))
        return n
      })
    } finally {
      setDeleting(false)
    }
  }

  async function handleKeepBoth() {
    setKeepBothBusy(true)
    try {
      await dedupApi.ignorePermanent(group.images.map(i => i.id))
      toast.success('Marked as "Keep Both" — permanently hidden', { icon: '♾️' })
      onKeepBoth()
    } catch (e) {
      toast.error('Failed to save — please try again')
    } finally {
      setKeepBothBusy(false)
    }
  }

  if (remaining.length < 2) {
    return (
      <div className="rounded-xl border border-vault-green/30 bg-vault-card p-3 opacity-60">
        <p className="text-vault-green text-sm">✓ Resolved</p>
      </div>
    )
  }

  const simPct   = Math.round(group.similarity * 100)
  const simColor = simPct >= 95 ? '#f87171' : simPct >= 80 ? '#BA7517' : 'rgba(255,255,255,0.55)'
  const galleries = [...new Set(group.images.map(i => i.gallery_name).filter(Boolean))]
  const creators  = [...new Set(group.images.map(i => i.creator_name).filter(Boolean))]
  const subtitle  = creators.length > 0
    ? creators.slice(0, 2).join(' · ') + (creators.length > 2 ? ` +${creators.length - 2}` : '')
    : galleries.slice(0, 2).join(' · ') + (galleries.length > 2 ? ` +${galleries.length - 2}` : '')

  return (
    <div className="rounded-xl border overflow-hidden"
         style={{ borderColor: upscaleFactor ? 'rgba(29,158,117,0.25)' : 'rgba(255,255,255,0.1)',
                  background: 'var(--c-card, #1e1e1e)' }}>
      <div className="flex items-center px-4 py-3">
        <button className="flex-1 flex items-center gap-2.5 hover:opacity-80 transition text-left min-w-0"
                onClick={() => setExpanded(e => !e)}>
          <span className="font-bold text-base flex-shrink-0" style={{ color: simColor }}>{simPct}%</span>
          <span className="text-white/40 text-sm flex-shrink-0">{remaining.length} imgs</span>
          {upscaleFactor && (
            <span className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-semibold flex-shrink-0"
                  style={{ color: '#1D9E75', background: 'rgba(29,158,117,0.12)', border: '0.5px solid rgba(29,158,117,0.3)' }}>
              <ArrowUpCircle size={10} /> {upscaleFactor}
            </span>
          )}
          {subtitle && <span className="text-white/30 text-xs truncate">{subtitle}</span>}
          {expanded ? <ChevronUp size={14} className="text-white/40 ml-auto flex-shrink-0" />
                    : <ChevronDown size={14} className="text-white/40 ml-auto flex-shrink-0" />}
        </button>

        <button onClick={e => { e.stopPropagation(); handleKeepBoth() }}
                disabled={keepBothBusy}
                className="ml-2 flex items-center gap-1 px-2.5 py-1.5 rounded-lg transition text-xs flex-shrink-0 disabled:opacity-50"
                style={{
                  color: upscaleFactor ? '#1D9E75' : 'rgba(255,255,255,0.3)',
                  background: upscaleFactor ? 'rgba(29,158,117,0.1)' : 'transparent',
                  border: upscaleFactor ? '1px solid rgba(29,158,117,0.25)' : '1px solid transparent',
                }}
                title="Keep both permanently — removes from duplicates forever, nothing deleted">
          <Infinity size={12} /> Keep Both
        </button>

        <button onClick={e => { e.stopPropagation(); onIgnore() }}
                className="ml-1 flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-white/25 hover:text-white/55 hover:bg-white/5 transition text-xs flex-shrink-0"
                title="Hide for this session">
          <EyeOff size={12} /> Ignore
        </button>
      </div>

      {expanded && (
        <div className="px-4 pb-4">
          <p className="text-white/35 text-xs mb-3">
            Click to mark as <span className="text-vault-green">Keep</span> — all others will be deleted.
          </p>
          <div className="grid gap-2"
               style={{ gridTemplateColumns: `repeat(${Math.min(remaining.length, 5)}, minmax(0, 1fr))` }}>
            {remaining.map(img => (
              <ImageCard key={img.id} img={img} isKeep={img.id === keepId}
                         onToggle={() => handleToggleKeep(img.id)} />
            ))}
          </div>

          <div className="mt-3 flex items-center justify-between">
            <p className="text-white/35 text-xs">
              {toDelete.length} image{toDelete.length !== 1 ? 's' : ''} will be deleted from disk
            </p>
            <button disabled={deleting || toDelete.length === 0} onClick={openConfirm}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/20 hover:bg-red-500/30 text-red-400 text-sm font-medium transition disabled:opacity-40">
              <Trash2 size={13} /> Delete {toDelete.length}
            </button>
          </div>

          {confirmOpen && (
            <div className="mt-2 p-3 rounded-lg border border-red-500/30 bg-red-500/10">
              <div className="flex items-start gap-2 mb-2">
                <AlertTriangle size={14} className="text-red-400 mt-0.5 flex-shrink-0" />
                <p className="text-white/75 text-sm">
                  Permanently delete {pendingIds.length} file{pendingIds.length !== 1 ? 's' : ''} from disk. Cannot be undone.
                </p>
              </div>
              <div className="flex gap-2">
                <button onClick={handleDeleteDupes}
                        className="px-3 py-1.5 rounded-lg bg-red-500 hover:bg-red-600 text-white text-sm font-medium transition">
                  Confirm
                </button>
                <button onClick={() => setConfirmOpen(false)}
                        className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-white/60 text-sm transition">
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Pagination ─────────────────────────────────────────────────────────────────

function Pagination({ page, totalPages, onChange }) {
  if (totalPages <= 1) return null
  const pages = Array.from({ length: totalPages }, (_, i) => i + 1)
    .filter(p => p === 1 || p === totalPages || Math.abs(p - page) <= 2)
    .reduce((acc, p, idx, arr) => {
      if (idx > 0 && p - arr[idx - 1] > 1) acc.push('…')
      acc.push(p)
      return acc
    }, [])

  return (
    <div className="flex items-center justify-center gap-2 pt-6 pb-2">
      <button onClick={() => onChange(page - 1)} disabled={page === 1}
              className="flex items-center gap-1 px-3 py-2 rounded-lg text-white/60 hover:text-white/90 transition disabled:opacity-30 text-sm"
              style={{ background: 'rgba(255,255,255,0.06)' }}>
        <ChevronLeft size={15} /> Prev
      </button>
      <div className="flex gap-1">
        {pages.map((p, i) =>
          p === '…' ? (
            <span key={`el-${i}`} className="px-2 py-2 text-white/25 text-sm select-none">…</span>
          ) : (
            <button key={p} onClick={() => onChange(p)}
                    className="w-8 h-8 rounded-lg text-sm font-medium transition"
                    style={{ background: p === page ? '#7F77DD' : 'rgba(255,255,255,0.06)', color: p === page ? '#fff' : 'rgba(255,255,255,0.5)' }}>
              {p}
            </button>
          )
        )}
      </div>
      <button onClick={() => onChange(page + 1)} disabled={page === totalPages}
              className="flex items-center gap-1 px-3 py-2 rounded-lg text-white/60 hover:text-white/90 transition disabled:opacity-30 text-sm"
              style={{ background: 'rgba(255,255,255,0.06)' }}>
        Next <ChevronRight size={15} />
      </button>
    </div>
  )
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function groupKey(group) {
  return group.images.map(i => i.id).sort((a, b) => a - b).join(',')
}

function computeAutoKeep(images) {
  if (!images?.length) return null
  return [...images].sort((a, b) => {
    const s = x => (x.rating || 0) * 10 + (x.cum_count || 0) + ((x.width || 0) * (x.height || 0)) / 1e6
    return s(b) - s(a)
  })[0]?.id ?? null
}

function detectUpscale(images) {
  if (images.length !== 2) return null
  const [a, b] = images
  if (!a.width || !b.width || !a.height || !b.height) return null
  const [lg, sm] = a.width * a.height >= b.width * b.height ? [a, b] : [b, a]
  const ratioW = lg.width  / sm.width
  const ratioH = lg.height / sm.height
  if (Math.abs(ratioW - ratioH) > 0.15) return null
  const ratio = (ratioW + ratioH) / 2
  if (Math.abs(ratio - 2) < 0.15) return '2×'
  if (Math.abs(ratio - 3) < 0.20) return '3×'
  if (Math.abs(ratio - 4) < 0.25) return '4×'
  return null
}

// ── Bulk delete bar ────────────────────────────────────────────────────────────

function BulkDeleteBar({ pageGroups, keepOverrides, deletedIds, onBulkDelete, busy }) {
  const [confirm, setConfirm] = useState(false)

  const preview = useMemo(() => {
    let total = 0
    let groups = 0
    for (const g of pageGroups) {
      const key = g._origKey ?? groupKey(g)
      const keepId = keepOverrides.current[key] ?? computeAutoKeep(g.images)
      const toDelete = g.images.filter(img => img.id !== keepId && !deletedIds.has(img.id))
      if (toDelete.length > 0) { total += toDelete.length; groups++ }
    }
    return { total, groups }
  }, [pageGroups, deletedIds])

  if (preview.total === 0) return null

  return (
    <div className="flex items-center gap-3 px-6 py-3 border-b border-white/7"
         style={{ background: confirm ? 'rgba(239,68,68,0.08)' : 'rgba(255,255,255,0.02)' }}>
      <Layers size={15} className="text-white/40 flex-shrink-0" />
      <span className="text-sm text-white/50 flex-1">
        <span className="text-white/75 font-medium">{preview.groups} groups</span>
        {' '}· {preview.total} images will be deleted using auto-selection
      </span>
      {confirm ? (
        <div className="flex items-center gap-2">
          <span className="text-red-400 text-xs font-medium">Are you sure?</span>
          <button onClick={() => { setConfirm(false); onBulkDelete() }}
                  disabled={busy}
                  className="px-3 py-1.5 rounded-lg bg-red-500 hover:bg-red-600 text-white text-xs font-semibold transition disabled:opacity-50">
            {busy ? 'Deleting…' : `Delete ${preview.total}`}
          </button>
          <button onClick={() => setConfirm(false)}
                  className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-white/60 text-xs transition">
            Cancel
          </button>
        </div>
      ) : (
        <button onClick={() => setConfirm(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-red-400 text-xs font-semibold transition"
                style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.2)' }}>
          <Trash2 size={12} /> Bulk Delete
        </button>
      )}
    </div>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function Duplicates() {
  const qc       = useQueryClient()
  const navigate = useNavigate()

  const [threshold,        setThreshold]        = useState(3)
  const [appliedThreshold, setAppliedThreshold] = useState(3)
  const [deletedIds,       setDeletedIds]        = useState(new Set())
  const [bulkBusy,         setBulkBusy]          = useState(false)

  // Per-group keep overrides set by user (ref so BulkDeleteBar doesn't re-render on every change)
  const keepOverrides = useRef({})

  // Filter + pagination state
  const [textSearch,     setTextSearch]     = useState('')
  const [creatorFilter,  setCreatorFilter]  = useState('')
  const [galleryFilter,  setGalleryFilter]  = useState('')
  const [page,           setPage]           = useState(1)

  // Session-ignored groups (localStorage)
  const [ignoredKeys, setIgnoredKeys] = useState(() => {
    try {
      const raw = localStorage.getItem('vault_ignored_dup_groups')
      return raw ? new Set(JSON.parse(raw)) : new Set()
    } catch { return new Set() }
  })

  // Permanently ignored count
  const [permanentIgnoredCount, setPermanentIgnoredCount] = useState(0)
  useEffect(() => {
    dedupApi.ignoredCount().then(r => setPermanentIgnoredCount(r.data.count)).catch(() => {})
  }, [])

  function ignoreGroup(group) {
    const key = group._origKey ?? groupKey(group)
    setIgnoredKeys(prev => {
      const next = new Set([...prev, key])
      try { localStorage.setItem('vault_ignored_dup_groups', JSON.stringify([...next])) } catch {}
      return next
    })
  }

  function clearIgnored() {
    setIgnoredKeys(new Set())
    try { localStorage.removeItem('vault_ignored_dup_groups') } catch {}
  }

  // Task queue
  const { data: taskState } = useQuery({
    queryKey: ['task-queue'],
    queryFn: () => tasksApi.queue().then(r => r.data),
    refetchInterval: q => {
      const d = q.state.data
      return (d?.current?.type === 'dedup_hash' || d?.queued?.some(t => t.type === 'dedup_hash')) ? 800 : 5000
    },
  })

  const dedupBusy = taskState?.current?.type === 'dedup_hash' ||
                    taskState?.queued?.some(t => t.type === 'dedup_hash')

  const { data: status, refetch: refetchStatus } = useQuery({
    queryKey: ['dedup-status'],
    queryFn: () => dedupApi.status().then(r => r.data),
    staleTime: 0, refetchInterval: 2000,
  })

  const { data: stats, refetch: refetchStats } = useQuery({
    queryKey: ['dedup-stats'],
    queryFn: () => dedupApi.stats().then(r => r.data),
    staleTime: 0, refetchInterval: dedupBusy ? 2000 : 8000,
  })

  const { data: groupsResp, isLoading: loadingGroups } = useQuery({
    queryKey: ['dedup-groups', appliedThreshold],
    queryFn: () => dedupApi.groups(appliedThreshold).then(r => r.data),
    enabled: (stats?.hashed ?? 0) > 0,
    staleTime: 0,
    refetchInterval: q => q.state.data?.computing ? 2000 : false,
  })

  const groups    = groupsResp?.groups  ?? groupsResp
  const computing = groupsResp?.computing ?? false
  const searchMsg = groupsResp?.message  ?? null

  const startMutation = useMutation({
    mutationFn: () => dedupApi.computeHashes(),
    onSuccess: () => {
      qc.invalidateQueries(['task-queue'])
      qc.invalidateQueries(['dedup-stats'])
      refetchStatus(); refetchStats()
      toast.success('Building hash index — queued in Task Queue', { duration: 4000, icon: '🔍' })
    },
    onError: err => toast.error(err?.response?.data?.detail || 'Failed to start'),
  })

  const cancelMutation = useMutation({
    mutationFn: () => tasksApi.cancelCurrent(),
    onSuccess: () => { qc.invalidateQueries(['task-queue']); refetchStatus(); toast('Cancelled', { icon: '✋' }) },
  })

  const [autoSearched, setAutoSearched] = React.useState(false)
  React.useEffect(() => {
    if (!autoSearched && (stats?.hashed ?? 0) > 0) {
      setAppliedThreshold(threshold)
      setAutoSearched(true)
    }
  }, [stats?.hashed, autoSearched, threshold])

  function runSearch() {
    clearIgnored()
    keepOverrides.current = {}
    setTextSearch(''); setCreatorFilter(''); setGalleryFilter('')
    setPage(1)
    qc.invalidateQueries({ queryKey: ['dedup-groups'] })
    setAppliedThreshold(threshold)
  }

  // Delete handler — NO cache invalidation, deletedIds state handles the UI instantly
  const handleDeleteImage = useCallback(ids => {
    const idArr = Array.isArray(ids) ? ids : [ids]
    setDeletedIds(prev => {
      const n = new Set(prev)
      idArr.forEach(id => n.add(id))
      return n
    })
  }, [])

  const handleKeepBoth = useCallback((group) => {
    const ids = group.images.map(i => i.id)
    setDeletedIds(prev => {
      const n = new Set(prev)
      ids.forEach(id => n.add(id))
      return n
    })
    setPermanentIgnoredCount(c => c + 1)
    // No cache invalidation — local state handles it immediately
  }, [])

  // Bulk delete current page using auto-selection (or user's manual pick)
  const handleBulkDeletePage = useCallback(async () => {
    setBulkBusy(true)
    try {
      const idsToDelete = []
      for (const g of pageGroupsRef.current) {
        const key    = g._origKey ?? groupKey(g)
        const keepId = keepOverrides.current[key] ?? computeAutoKeep(g.images)
        g.images.forEach(img => {
          if (img.id !== keepId && !deletedIds.has(img.id)) idsToDelete.push(img.id)
        })
      }
      if (idsToDelete.length === 0) return
      await imagesApi.bulkDelete(idsToDelete)
      toast.success(`Deleted ${idsToDelete.length} images across page`, { duration: 4000 })
      handleDeleteImage(idsToDelete)
    } catch (e) {
      toast.error('Bulk delete failed')
    } finally {
      setBulkBusy(false)
    }
  }, [deletedIds, handleDeleteImage])

  // Keep a ref to current page groups so handleBulkDeletePage always sees latest
  const pageGroupsRef = useRef([])

  // Base groups — filter deleted + ignored
  const baseGroups = useMemo(() => {
    const rawGroups = Array.isArray(groups) ? groups : []
    const result = []
    for (const g of rawGroups) {
      const origKey = groupKey(g)
      if (ignoredKeys.has(origKey)) continue
      const filteredImages = g.images.filter(img => !deletedIds.has(img.id))
      if (filteredImages.length < 2) continue
      result.push({ ...g, images: filteredImages, _origKey: origKey })
    }
    return result
  }, [groups, ignoredKeys, deletedIds])

  // Unique creator/gallery lists for dropdowns
  const allCreators = useMemo(() => {
    const names = new Map()
    baseGroups.forEach(g => g.images.forEach(img => {
      if (img.creator_name) names.set(img.creator_name, img.creator_name)
    }))
    return [...names.values()].sort((a, b) => a.localeCompare(b)).map(n => ({ value: n, label: n }))
  }, [baseGroups])

  const allGalleries = useMemo(() => {
    const names = new Set()
    baseGroups.forEach(g => g.images.forEach(img => { if (img.gallery_name) names.add(img.gallery_name) }))
    return [...names].sort((a, b) => a.localeCompare(b)).map(n => ({ value: n, label: n }))
  }, [baseGroups])

  // Apply filters
  const filteredGroups = useMemo(() => {
    let out = baseGroups
    if (creatorFilter) out = out.filter(g => g.images.some(img => img.creator_name === creatorFilter))
    if (galleryFilter) out = out.filter(g => g.images.some(img => img.gallery_name === galleryFilter))
    if (textSearch.trim()) {
      const lc = textSearch.trim().toLowerCase()
      out = out.filter(g => g.images.some(img =>
        img.gallery_name?.toLowerCase().includes(lc) ||
        img.creator_name?.toLowerCase().includes(lc) ||
        img.filename?.toLowerCase().includes(lc)
      ))
    }
    return out
  }, [baseGroups, creatorFilter, galleryFilter, textSearch])

  const totalPages = Math.max(1, Math.ceil(filteredGroups.length / PAGE_SIZE))
  const safePage   = Math.min(page, totalPages)
  const pageGroups = filteredGroups.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)
  pageGroupsRef.current = pageGroups

  const activeFilters = [creatorFilter, galleryFilter, textSearch.trim()].filter(Boolean).length
  const indexedPct    = stats?.total > 0 ? Math.round((stats.hashed / stats.total) * 100) : 0

  React.useEffect(() => { setPage(1) }, [creatorFilter, galleryFilter, textSearch, appliedThreshold])

  return (
    <div className="flex h-full overflow-hidden">

      {/* ── Left panel: controls ──────────────────────────────────────────────── */}
      <div className="w-[280px] flex-shrink-0 flex flex-col gap-4 p-5 border-r overflow-y-auto"
           style={{ borderColor: 'rgba(255,255,255,0.07)', background: 'var(--c-surface)', scrollbarWidth: 'none' }}>

        {/* Title */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-lg font-bold text-white/90">Duplicate Finder</h1>
            <p className="text-white/40 text-xs mt-0.5">
              {stats?.total != null ? `${stats.hashed?.toLocaleString()} / ${stats.total?.toLocaleString()} indexed (${indexedPct}%)` : 'Loading…'}
            </p>
          </div>
          <button onClick={() => navigate('/task-queue')}
                  className="text-white/25 hover:text-white/55 transition mt-0.5" title="Task Queue">
            <ExternalLink size={13} />
          </button>
        </div>

        {/* Hash index */}
        <HashProgress
          status={status} taskState={taskState} stats={stats}
          isPending={startMutation.isPending}
          onStart={() => startMutation.mutate()}
          onCancel={() => cancelMutation.mutate()}
        />

        {/* Threshold */}
        {(stats?.hashed ?? 0) > 0 && (
          <div className="rounded-xl border border-white/10 p-4 flex flex-col gap-3"
               style={{ background: 'rgba(255,255,255,0.02)' }}>
            <div>
              <label className="block text-white/65 text-xs mb-1">
                Similarity — max distance:{' '}
                <span className="text-white font-semibold">{threshold}</span>
                <span className="text-white/35 ml-1">({Math.round((1 - threshold / 64) * 100)}%+)</span>
              </label>
              <input type="range" min={0} max={30} value={threshold}
                     onChange={e => setThreshold(+e.target.value)}
                     className="w-full accent-vault-accent" />
              <div className="flex justify-between text-[10px] text-white/25 mt-0.5">
                <span>Identical</span><span>Near-exact</span><span>Similar</span><span>Loose</span>
              </div>
            </div>
            <button onClick={runSearch}
                    className="w-full px-3 py-2 rounded-lg font-semibold text-sm transition"
                    style={{ background: '#7F77DD', color: '#fff' }}>
              Find Duplicates
            </button>
          </div>
        )}

        {/* Filters */}
        {baseGroups.length > 0 && (
          <div className="rounded-xl border border-white/10 p-4 flex flex-col gap-2.5"
               style={{ background: 'rgba(255,255,255,0.02)' }}>
            <p className="text-xs font-medium text-white/40 uppercase tracking-wider">Filters</p>
            <div className="relative">
              <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-white/30 pointer-events-none" />
              <input type="text" placeholder="Search…" value={textSearch}
                     onChange={e => setTextSearch(e.target.value)}
                     className="w-full pl-7 pr-7 py-2 rounded-lg text-white/80 text-xs placeholder-white/25 focus:outline-none"
                     style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)' }} />
              {textSearch && (
                <button onClick={() => setTextSearch('')}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60 transition">
                  <X size={11} />
                </button>
              )}
            </div>
            {allCreators.length > 0 && (
              <FilterDropdown icon={User} placeholder="All creators" value={creatorFilter}
                              options={allCreators} onChange={setCreatorFilter} onClear={() => setCreatorFilter('')} />
            )}
            {allGalleries.length > 0 && (
              <FilterDropdown icon={FolderOpen} placeholder="All galleries" value={galleryFilter}
                              options={allGalleries} onChange={setGalleryFilter} onClear={() => setGalleryFilter('')} />
            )}
            {activeFilters > 0 && (
              <button onClick={() => { setTextSearch(''); setCreatorFilter(''); setGalleryFilter('') }}
                      className="flex items-center gap-1 text-xs text-white/35 hover:text-white/60 transition">
                <X size={11} /> Clear filters
              </button>
            )}
          </div>
        )}

        {/* Stats */}
        {baseGroups.length > 0 && (
          <div className="text-xs text-white/30 flex flex-col gap-1 pt-1">
            <span>
              {filteredGroups.length === baseGroups.length
                ? `${baseGroups.length.toLocaleString()} groups`
                : `${filteredGroups.length.toLocaleString()} of ${baseGroups.length.toLocaleString()} groups`}
            </span>
            {ignoredKeys.size > 0 && (
              <span>
                {ignoredKeys.size} hidden this session{' '}
                <button onClick={clearIgnored} className="text-vault-accent/60 hover:text-vault-accent transition underline underline-offset-2">show</button>
              </span>
            )}
            {permanentIgnoredCount > 0 && (
              <span className="flex items-center gap-1">
                <Infinity size={10} /> {permanentIgnoredCount} permanently kept
              </span>
            )}
          </div>
        )}
      </div>

      {/* ── Right panel: results ──────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden">

        {/* Bulk delete bar — sticky */}
        {pageGroups.length > 0 && (
          <BulkDeleteBar
            pageGroups={pageGroups}
            keepOverrides={keepOverrides}
            deletedIds={deletedIds}
            onBulkDelete={handleBulkDeletePage}
            busy={bulkBusy}
          />
        )}

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto p-6">

          {/* Computing spinner */}
          {(loadingGroups || computing) && (
            <div className="rounded-xl border border-white/10 bg-vault-card p-5 mb-4 flex items-center gap-4">
              <ScanLine size={20} className="text-vault-accent animate-spin flex-shrink-0" />
              <div>
                <p className="text-white/75 text-base font-medium">Scanning for duplicates…</p>
                {searchMsg && <p className="text-white/40 text-sm mt-0.5">{searchMsg}</p>}
              </div>
            </div>
          )}

          {/* No dupes */}
          {!loadingGroups && !computing && baseGroups.length === 0 && (stats?.hashed ?? 0) > 0 && (
            <div className="text-center py-20">
              <CheckCircle size={40} className="mx-auto mb-3 text-vault-green" />
              {ignoredKeys.size > 0 ? (
                <>
                  <p className="text-white/65 text-base font-medium">All groups ignored</p>
                  <p className="text-white/35 text-sm mt-1">
                    {ignoredKeys.size} hidden.{' '}
                    <button onClick={clearIgnored} className="text-vault-accent/70 hover:text-vault-accent underline underline-offset-2">Show all</button>
                  </p>
                </>
              ) : (
                <>
                  <p className="text-white/65 text-base font-medium">No duplicates found</p>
                  <p className="text-white/35 text-sm mt-1">Try increasing the threshold</p>
                </>
              )}
            </div>
          )}

          {/* No index */}
          {(stats?.hashed ?? 0) === 0 && !status?.running && (
            <div className="text-center py-20">
              <ScanLine size={44} className="mx-auto mb-4 text-white/20" />
              <p className="text-white/55 text-base font-medium">No images indexed yet</p>
              <p className="text-white/30 text-sm mt-1">Click "Build" in the panel to compute hashes</p>
            </div>
          )}

          {/* Filter no match */}
          {!computing && baseGroups.length > 0 && filteredGroups.length === 0 && (
            <div className="text-center py-12 text-white/35 text-sm">
              No groups match the current filters.{' '}
              <button onClick={() => { setTextSearch(''); setCreatorFilter(''); setGalleryFilter('') }}
                      className="text-vault-accent/70 hover:text-vault-accent transition underline underline-offset-2">
                Clear filters
              </button>
            </div>
          )}

          {/* Groups */}
          {!computing && pageGroups.length > 0 && (
            <div className="space-y-3">
              {pageGroups.map(group => (
                <DuplicateGroup
                  key={group._origKey ?? groupKey(group)}
                  group={group}
                  onDeleteImage={handleDeleteImage}
                  onIgnore={() => ignoreGroup(group)}
                  onKeepBoth={() => handleKeepBoth(group)}
                  onKeepChange={keepId => {
                    const key = group._origKey ?? groupKey(group)
                    keepOverrides.current[key] = keepId
                  }}
                />
              ))}
            </div>
          )}

          <Pagination
            page={safePage} totalPages={totalPages}
            onChange={p => { setPage(p); window.scrollTo({ top: 0, behavior: 'smooth' }) }}
          />
        </div>
      </div>
    </div>
  )
}

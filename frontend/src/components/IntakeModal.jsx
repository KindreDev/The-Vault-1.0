import React, { useState, useEffect, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  X, Inbox, FolderOpen, Loader2, Check, Search, FileArchive, Video,
  Film, Settings, Trash2, FolderPlus, ArrowRight, RefreshCw, Eye,
  AlertTriangle, Image as ImageIcon, File as FileIcon, SlidersHorizontal,
} from 'lucide-react'
import { intakeApi, creatorsApi, galleriesApi, scannerApi } from '../lib/api'
import { useT } from '../i18n'
import toast from 'react-hot-toast'

const CREATOR_TYPES = ['cosplayer', 'ethot', 'artist', 'character', 'actress', 'custom']

function fmtSize(bytes) {
  if (!bytes && bytes !== 0) return ''
  const mb = bytes / (1024 * 1024)
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`
  if (mb >= 1) return `${mb.toFixed(1)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

function normList(data) {
  if (Array.isArray(data)) return data
  return data?.items ?? data?.creators ?? data?.galleries ?? []
}

export default function IntakeModal({ onClose }) {
  const t = useT()
  const qc = useQueryClient()

  const [selected, setSelected]   = useState(() => new Set())
  const [lastIdx, setLastIdx]     = useState(null)
  const [scanning, setScanning]   = useState(false)
  const [busy, setBusy]           = useState(false)     // commit/discard in flight
  const [report, setReport]       = useState(null)
  const [showSettings, setShowSettings] = useState(false)
  const [job, setJob]             = useState(null)      // { id, kind: 'scan'|'commit' } we launched
  const [doneFlash, setDoneFlash] = useState(false)     // brief "Done ✓" bar after a commit
  const [conflict, setConflict]   = useState(null)      // duplicate items pending user decision
  const [archiveItem, setArchiveItem] = useState(null)  // archive being previewed

  // Destination
  const [creatorId, setCreatorId] = useState(null)
  const [mode, setMode]           = useState('creator_root')  // creator_root | new_folder | existing_gallery | new_creator
  const [folderName, setFolderName] = useState('')
  const [galleryId, setGalleryId] = useState(null)
  const [newName, setNewName]     = useState('')
  const [newType, setNewType]     = useState('cosplayer')
  const [creatorSearch, setCreatorSearch] = useState('')
  const [gallerySearch, setGallerySearch] = useState('')

  // File-type filter: 'all' | 'image' | 'video' | 'archive'
  const [typeFilter, setTypeFilter] = useState('all')
  const [nameSearch, setNameSearch] = useState('')

  // Sort: field 'date' | 'size' | 'name', dir 1 = asc, -1 = desc. Default newest-first.
  const [sortField, setSortField] = useState('date')
  const [sortDir, setSortDir]     = useState(-1)

  // ── Data ─────────────────────────────────────────────────────────────────
  const { data: roots = [] } = useQuery({
    queryKey: ['intake-roots'],
    queryFn: () => intakeApi.roots().then(r => r.data),
  })

  const { data: itemData, refetch: refetchItems } = useQuery({
    queryKey: ['intake-items'],
    queryFn: () => intakeApi.items('pending').then(r => r.data),
  })
  const allItems = itemData?.items ?? []

  const filteredItems = useMemo(() => {
    let list = allItems
    if (typeFilter === 'image') {
      list = list.filter(i => !i.is_video && !i.is_archive)
    } else if (typeFilter === 'video') {
      list = list.filter(i => i.is_video)
    } else if (typeFilter === 'archive') {
      list = list.filter(i => i.is_archive)
    }
    const q = nameSearch.trim().toLowerCase()
    if (q) {
      list = list.filter(i => i.filename?.toLowerCase().includes(q))
    }
    list = [...list].sort((a, b) => {
      let cmp = 0
      if (sortField === 'date') {
        cmp = new Date(a.discovered_at || 0) - new Date(b.discovered_at || 0)
      } else if (sortField === 'size') {
        cmp = (a.file_size || 0) - (b.file_size || 0)
      } else if (sortField === 'name') {
        cmp = (a.filename || '').localeCompare(b.filename || '')
      }
      return cmp * sortDir
    })
    return list
  }, [allItems, typeFilter, nameSearch, sortField, sortDir])

  const items = filteredItems

  const { data: status } = useQuery({
    queryKey: ['intake-status'],
    queryFn: () => intakeApi.status().then(r => r.data),
    refetchInterval: (scanning || busy) ? 1200 : false,
  })

  const { data: creators = [] } = useQuery({
    queryKey: ['creators-all'],
    queryFn: () => creatorsApi.list({ limit: 2000 }).then(r => normList(r.data)),
  })

  const { data: galleries = [] } = useQuery({
    queryKey: ['creator-galleries', creatorId],
    queryFn: () => galleriesApi.list({ creator_id: creatorId, limit: 1000 }).then(r => normList(r.data)),
    enabled: mode === 'existing_gallery' && !!creatorId,
  })

  // Watch OUR job finish. Matching on done_job_id (not just running=false) is
  // what fixes the "0 sorted" ghost: the task queue may not have started the
  // job yet when the first poll lands, and a stale report from a previous run
  // must never be mistaken for this one.
  useEffect(() => {
    if (!job || !status || status.done_job_id !== job.id) return
    if (job.kind === 'commit') {
      setBusy(false)
      setReport(status.report || [])
      setSelected(new Set())
      setDoneFlash(true)
      setTimeout(() => setDoneFlash(false), 2200)
      qc.invalidateQueries({ queryKey: ['galleries'] })
      qc.invalidateQueries({ queryKey: ['stats'] })
      qc.invalidateQueries({ queryKey: ['creators'] })
    } else {
      setScanning(false)
    }
    setJob(null)
    refetchItems()   // sorted files are already status=committed → vanish from the feed
  }, [job, status]) // eslint-disable-line

  const filteredCreators = useMemo(() => {
    const q = creatorSearch.trim().toLowerCase()
    if (!q) return creators.slice(0, 40)
    return creators.filter(c => c.name?.toLowerCase().includes(q)).slice(0, 40)
  }, [creators, creatorSearch])

  const filteredGalleries = useMemo(() => {
    const q = gallerySearch.trim().toLowerCase()
    if (!q) return galleries
    return galleries.filter(g => g.name?.toLowerCase().includes(q))
  }, [galleries, gallerySearch])

  const selectedCreator = creators.find(c => c.id === creatorId)

  // ── Actions ──────────────────────────────────────────────────────────────
  const doScan = async () => {
    setReport(null)
    setScanning(true)
    try {
      const { data } = await intakeApi.scan()
      setJob({ id: data.job_id, kind: 'scan' })
    }
    catch { setScanning(false); toast.error(t('Failed to start scan')) }
  }

  const addRoot = async () => {
    try {
      const { data } = await scannerApi.browseFolder()
      if (!data?.path) return
      await intakeApi.addRoot(data.path)
      qc.invalidateQueries({ queryKey: ['intake-roots'] })
      toast.success(t('Loading Bay folder added'))
    } catch (e) {
      toast.error(e?.response?.data?.detail || t('Could not add folder'))
    }
  }

  const toggle = (idx, id, e) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (e.shiftKey && lastIdx !== null) {
        const [a, b] = [Math.min(lastIdx, idx), Math.max(lastIdx, idx)]
        for (let i = a; i <= b; i++) next.add(items[i].id)
      } else {
        next.has(id) ? next.delete(id) : next.add(id)
      }
      return next
    })
    setLastIdx(idx)
  }

  const selectAll = () => {
    setSelected(prev => prev.size === items.length ? new Set() : new Set(items.map(i => i.id)))
  }

  const buildTarget = () => {
    if (mode === 'new_creator') {
      if (!newName.trim()) { toast.error(t('Enter a name for the new creator')); return null }
      return { mode, new_creator: { name: newName.trim(), creator_type: newType } }
    }
    if (!creatorId) { toast.error(t('Pick a creator first')); return null }
    if (mode === 'new_folder' && !folderName.trim()) { toast.error(t('Enter a folder name')); return null }
    if (mode === 'existing_gallery' && !galleryId) { toast.error(t('Pick a gallery')); return null }
    return {
      mode, creator_id: creatorId,
      folder_name: folderName.trim() || undefined,
      gallery_id: galleryId || undefined,
    }
  }

  const commitIds = async (ids) => {
    if (ids.length === 0) return
    const target = buildTarget()
    if (!target) return
    setReport(null)
    setBusy(true)
    try {
      const { data } = await intakeApi.commit(ids, target)
      setJob({ id: data.job_id, kind: 'commit' })
    }
    catch (e) { setBusy(false); toast.error(e?.response?.data?.detail || t('Commit failed')) }
  }

  const doCommit = () => {
    if (selected.size === 0) return
    if (!buildTarget()) return   // validate destination before any dialog
    const dupes = items.filter(i => selected.has(i.id) && i.duplicate_of)
    if (dupes.length > 0) { setConflict(dupes); return }
    commitIds([...selected])
  }

  const resolveConflict = async (choice) => {
    const dupIds = new Set(conflict.map(d => d.id))
    const nonDup = [...selected].filter(id => !dupIds.has(id))
    setConflict(null)
    if (choice === 'all') {
      commitIds([...selected])
    } else if (choice === 'skip') {
      setSelected(new Set(nonDup))
      commitIds(nonDup)
    } else if (choice === 'delete') {
      try { await intakeApi.discard([...dupIds], true) }
      catch { toast.error(t('Could not delete duplicates')) }
      setSelected(new Set(nonDup))
      refetchItems()
      commitIds(nonDup)
    }
  }

  const doDiscard = async (deleteFile) => {
    if (selected.size === 0) return
    if (deleteFile && !window.confirm(t('Permanently delete the selected files from disk?'))) return
    try {
      await intakeApi.discard([...selected], deleteFile)
      setSelected(new Set())
      refetchItems()
    } catch { toast.error(t('Could not discard')) }
  }

  const running = scanning || busy
  const pct = status?.total > 0 ? Math.round((status.progress / status.total) * 100) : null

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center animate-fade-in"
         style={{ background: 'rgba(0,0,0,0.75)' }}
         onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="rounded-[16px] shadow-2xl animate-modal-pop flex flex-col"
           style={{ width: 'min(1680px, 86vw)', height: 'min(1000px, 88vh)',
                    background: 'var(--c-surface, #141414)', border: '0.5px solid rgba(255,255,255,0.12)' }}>

        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 flex-shrink-0"
             style={{ borderBottom: '0.5px solid rgba(255,255,255,0.07)' }}>
          <Inbox size={18} style={{ color: 'var(--accent)' }} />
          <div className="flex-1">
            <div style={{ fontSize: 17, fontWeight: 600, color: 'rgba(255,255,255,0.9)' }}>{t('Loading Bay')}</div>
            <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.4)' }}>
              {t('Sort downloaded files into your vault')}
            </div>
          </div>
          <button onMouseDown={() => setShowSettings(s => !s)} className="cursor-pointer p-1.5 rounded-[8px]"
                  style={{ color: showSettings ? 'var(--accent)' : 'rgba(255,255,255,0.4)',
                           background: showSettings ? 'color-mix(in srgb, var(--accent) 12%, transparent)' : 'transparent' }}>
            <Settings size={16} />
          </button>
          <button onMouseDown={onClose} className="cursor-pointer" style={{ color: 'rgba(255,255,255,0.35)' }}>
            <X size={18} />
          </button>
        </div>

        {showSettings
          ? <IntakeSettings roots={roots} onAddRoot={addRoot} qc={qc} t={t} />
          : (
          <div className="flex flex-1 min-h-0">
            {/* LEFT: item grid */}
            <div className="flex flex-col flex-1 min-w-0" style={{ borderRight: '0.5px solid rgba(255,255,255,0.07)' }}>
              {/* Toolbar */}
              <div className="flex items-center gap-2 px-4 py-3 flex-shrink-0 flex-wrap">
                <button onMouseDown={doScan} disabled={running}
                        className="flex items-center gap-2 px-3 py-2 rounded-[8px] cursor-pointer disabled:opacity-50"
                        style={{ background: 'color-mix(in srgb, var(--c-green) 14%, transparent)', color: 'color-mix(in srgb, var(--c-green) 65%, white)',
                                 border: '0.5px solid color-mix(in srgb, var(--c-green) 30%, transparent)', fontSize: 15, fontWeight: 500 }}>
                  {scanning ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
                  {t('Scan Downloads')}
                </button>
                {allItems.length > 0 && (
                  <button onMouseDown={selectAll} className="px-3 py-2 rounded-[8px] cursor-pointer"
                          style={{ background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.6)', fontSize: 14 }}>
                    {selected.size === items.length ? t('Clear') : t('Select all')}
                  </button>
                )}
                <div className="flex-1" />
                <span style={{ fontSize: 14, color: 'rgba(255,255,255,0.4)' }}>
                  {selected.size > 0 ? `${selected.size} / ${items.length}` : `${items.length} ${t('pending')}`}
                </span>
              </div>

              {/* Search + file-type filter + sort bar */}
              {allItems.length > 0 && (
                <div className="flex items-center gap-1.5 px-4 pb-3 flex-shrink-0 flex-wrap">
                  <div className="flex items-center gap-2 px-2.5 py-1 rounded-full"
                       style={{ background: nameSearch.trim() ? 'color-mix(in srgb, var(--accent) 14%, transparent)' : 'rgba(255,255,255,0.05)',
                                border: `0.5px solid ${nameSearch.trim() ? 'color-mix(in srgb, var(--accent) 35%, transparent)' : 'rgba(255,255,255,0.08)'}` }}>
                    <Search size={13} style={{ color: 'rgba(255,255,255,0.35)', flexShrink: 0 }} />
                    <input value={nameSearch} onChange={e => setNameSearch(e.target.value)}
                           placeholder={t('Search filenames…')}
                           className="bg-transparent outline-none"
                           style={{ width: 140, fontSize: 13, color: 'rgba(255,255,255,0.8)' }} />
                  </div>
                  <SlidersHorizontal size={13} style={{ color: 'rgba(255,255,255,0.3)', flexShrink: 0 }} />
                  {[
                    ['all', t('All')],
                    ['image', t('Images')],
                    ['video', t('Videos')],
                    ['archive', t('Archives')],
                  ].map(([key, label]) => (
                    <button key={key}
                            onMouseDown={() => setTypeFilter(key)}
                            className="px-2.5 py-1 rounded-full cursor-pointer transition-colors"
                            style={{
                              fontSize: 13, fontWeight: 500,
                              background: typeFilter === key
                                ? 'color-mix(in srgb, var(--accent) 20%, transparent)' : 'rgba(255,255,255,0.05)',
                              color: typeFilter === key ? 'color-mix(in srgb, var(--accent) 85%, white)' : 'rgba(255,255,255,0.55)',
                              border: `0.5px solid ${typeFilter === key ? 'color-mix(in srgb, var(--accent) 40%, transparent)' : 'rgba(255,255,255,0.08)'}`,
                            }}>
                      {label}
                    </button>
                  ))}

                  <div className="flex-1" />

                  {/* Sort control */}
                  <div className="flex items-center gap-1">
                    {[
                      ['date', t('Date')],
                      ['size', t('Size')],
                      ['name', t('Name')],
                    ].map(([key, label]) => {
                      const active = sortField === key
                      const arrow = !active ? '' : (
                        key === 'name'
                          ? (sortDir === 1 ? ' A→Z' : ' Z→A')
                          : (sortDir === -1 ? ' ↓' : ' ↑')
                      )
                      return (
                        <button key={key}
                                onMouseDown={() => {
                                  if (active) setSortDir(d => -d)
                                  else { setSortField(key); setSortDir(-1) }
                                }}
                                title={key === 'date' ? t('Newer / older') : key === 'size' ? t('Heavier / lighter') : t('A→Z / Z→A')}
                                className="px-2.5 py-1 rounded-full cursor-pointer transition-colors"
                                style={{
                                  fontSize: 13, fontWeight: 500,
                                  background: active ? 'color-mix(in srgb, var(--accent) 20%, transparent)' : 'rgba(255,255,255,0.05)',
                                  color: active ? 'color-mix(in srgb, var(--accent) 85%, white)' : 'rgba(255,255,255,0.55)',
                                  border: `0.5px solid ${active ? 'color-mix(in srgb, var(--accent) 40%, transparent)' : 'rgba(255,255,255,0.08)'}`,
                                  whiteSpace: 'nowrap',
                                }}>
                          {label}{arrow}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Progress */}
              <div className={`px-4 flex-shrink-0 grid transition-all duration-300 ease-out ${(running || doneFlash) ? 'pb-2' : ''}`}
                   style={{ gridTemplateRows: (running || doneFlash) ? '1fr' : '0fr', opacity: (running || doneFlash) ? 1 : 0 }}>
                <div className="overflow-hidden">
                  <div className="flex items-center justify-between" style={{ fontSize: 13, marginBottom: 4 }}>
                    <span style={{ color: doneFlash ? 'color-mix(in srgb, var(--c-green) 65%, white)' : 'color-mix(in srgb, var(--accent) 85%, white)', fontWeight: doneFlash ? 600 : 400 }}>
                      {doneFlash ? `✓ ${t('Done')}` : (status?.message || t('Working…'))}
                    </span>
                    {!doneFlash && status?.total > 0 && (
                      <span style={{ color: 'rgba(255,255,255,0.4)' }}>{status.progress} / {status.total}</span>
                    )}
                  </div>
                  <div className="rounded-full overflow-hidden" style={{ height: 6, background: 'rgba(255,255,255,0.08)' }}>
                    <div className="h-full transition-all duration-300"
                         style={{ width: doneFlash ? '100%' : `${pct ?? 5}%`,
                                  background: doneFlash ? 'var(--c-green)' : 'var(--accent)' }} />
                  </div>
                </div>
              </div>

              {/* Grid */}
              <div className="flex-1 overflow-y-auto px-4 pb-4">
                {items.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center gap-2 text-center" style={{ color: 'rgba(255,255,255,0.3)' }}>
                    <Inbox size={34} />
                    <div style={{ fontSize: 16 }}>
                      {allItems.length > 0
                        ? t('No pending files match this filter.')
                        : (roots.length === 0 ? t('Add a downloads folder in settings, then scan.') : t('Nothing pending. Hit “Scan Downloads”.'))}
                    </div>
                  </div>
                ) : (
                  <div className="grid gap-2.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}>
                    {items.map((it, idx) => (
                      <IntakeTile key={it.id} it={it} idx={idx} on={selected.has(it.id)}
                                  t={t} onToggle={toggle} onPeek={() => setArchiveItem(it)} />
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* RIGHT: destination */}
            <div className="flex flex-col flex-shrink-0" style={{ width: 380 }}>
              <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
                {report && (
                  <div className="rounded-[10px] p-3" style={{ background: 'color-mix(in srgb, var(--c-green) 10%, transparent)', border: '0.5px solid color-mix(in srgb, var(--c-green) 30%, transparent)' }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: 'color-mix(in srgb, var(--c-green) 65%, white)', marginBottom: 4 }}>
                      {report.filter(r => r.result !== 'error').length} {t('sorted')}
                      {report.some(r => r.result === 'error') && ` · ${report.filter(r => r.result === 'error').length} ${t('failed')}`}
                    </div>
                    {report.filter(r => r.result === 'error').slice(0, 4).map(r => (
                      <div key={r.item_id} style={{ fontSize: 12, color: 'color-mix(in srgb, var(--c-pink) 70%, white)' }} className="truncate">{r.filename}: {r.message}</div>
                    ))}
                  </div>
                )}

                <div style={{ fontSize: 13, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'rgba(255,255,255,0.4)' }}>
                  {t('Send to')}
                </div>

                {/* Creator search + list (hidden in new_creator mode) */}
                {mode !== 'new_creator' && (
                  <div>
                    <div className="flex items-center gap-2 px-3 py-2 rounded-[8px] mb-2"
                         style={{ background: 'rgba(255,255,255,0.05)', border: '0.5px solid rgba(255,255,255,0.08)' }}>
                      <Search size={14} style={{ color: 'rgba(255,255,255,0.35)' }} />
                      <input value={creatorSearch} onChange={e => setCreatorSearch(e.target.value)}
                             placeholder={t('Search creators…')}
                             className="bg-transparent outline-none flex-1"
                             style={{ fontSize: 14, color: 'rgba(255,255,255,0.85)' }} />
                    </div>
                    <div className="rounded-[8px] overflow-y-auto" style={{ maxHeight: 190, border: '0.5px solid rgba(255,255,255,0.06)' }}>
                      {filteredCreators.map(c => (
                        <button key={c.id} onMouseDown={() => { setCreatorId(c.id); setGalleryId(null) }}
                                className="w-full text-left px-3 py-2 cursor-pointer transition-colors truncate"
                                style={{ fontSize: 14, background: creatorId === c.id ? 'color-mix(in srgb, var(--accent) 18%, transparent)' : 'transparent',
                                         color: creatorId === c.id ? 'color-mix(in srgb, var(--accent) 85%, white)' : 'rgba(255,255,255,0.7)' }}>
                          {c.name}{!c.source_folder && <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 12 }}> · {t('auto folder')}</span>}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Mode picker */}
                <div className="flex flex-col gap-1.5">
                  <ModeRow icon={FolderOpen} label={t('Creator root folder')} active={mode === 'creator_root'} onPick={() => setMode('creator_root')} />
                  <ModeRow icon={FolderPlus} label={t('New folder')} active={mode === 'new_folder'} onPick={() => setMode('new_folder')} />
                  <ModeRow icon={FolderOpen} label={t('Existing gallery')} active={mode === 'existing_gallery'} onPick={() => setMode('existing_gallery')} />
                  <ModeRow icon={FolderPlus} label={t('New creator')} active={mode === 'new_creator'} onPick={() => setMode('new_creator')} />
                </div>

                {/* Mode-specific inputs */}
                {mode === 'new_folder' && (
                  <input value={folderName} onChange={e => setFolderName(e.target.value)}
                         placeholder={t('Folder name…')}
                         className="px-3 py-2 rounded-[8px] outline-none"
                         style={{ background: 'rgba(255,255,255,0.05)', border: '0.5px solid rgba(255,255,255,0.1)', fontSize: 14, color: 'rgba(255,255,255,0.85)' }} />
                )}
                {mode === 'existing_gallery' && (
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center gap-2 px-3 py-2 rounded-[8px]"
                         style={{ background: 'rgba(255,255,255,0.05)', border: '0.5px solid rgba(255,255,255,0.08)' }}>
                      <Search size={14} style={{ color: 'rgba(255,255,255,0.35)' }} />
                      <input value={gallerySearch} onChange={e => setGallerySearch(e.target.value)}
                             placeholder={t('Search galleries…')}
                             className="bg-transparent outline-none flex-1"
                             style={{ fontSize: 14, color: 'rgba(255,255,255,0.85)' }} />
                    </div>
                    <div className="rounded-[8px] overflow-y-auto" style={{ maxHeight: 220, border: '0.5px solid rgba(255,255,255,0.06)' }}>
                      {!creatorId ? <div className="px-3 py-2" style={{ fontSize: 14, color: 'rgba(255,255,255,0.35)' }}>{t('Pick a creator first')}</div>
                       : filteredGalleries.length === 0 ? <div className="px-3 py-2" style={{ fontSize: 14, color: 'rgba(255,255,255,0.35)' }}>{t('No galleries')}</div>
                       : filteredGalleries.map(g => (
                          <button key={g.id} onMouseDown={() => setGalleryId(g.id)}
                                  className="w-full text-left px-3 py-2 cursor-pointer truncate"
                                  style={{ fontSize: 14, background: galleryId === g.id ? 'color-mix(in srgb, var(--accent) 18%, transparent)' : 'transparent',
                                           color: galleryId === g.id ? 'color-mix(in srgb, var(--accent) 85%, white)' : 'rgba(255,255,255,0.7)' }}>
                            {g.name}
                          </button>
                        ))}
                    </div>
                  </div>
                )}
                {mode === 'new_creator' && (
                  <div className="flex flex-col gap-2">
                    <input value={newName} onChange={e => setNewName(e.target.value)}
                           placeholder={t('New creator name…')}
                           className="px-3 py-2 rounded-[8px] outline-none"
                           style={{ background: 'rgba(255,255,255,0.05)', border: '0.5px solid rgba(255,255,255,0.1)', fontSize: 14, color: 'rgba(255,255,255,0.85)' }} />
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'rgba(255,255,255,0.4)', marginBottom: 5 }}>
                        {t('Creator type')}
                      </div>
                      <select value={newType} onChange={e => setNewType(e.target.value)}
                              className="w-full px-3 py-2 rounded-[8px] outline-none cursor-pointer"
                              style={{ background: 'var(--c-card, #1c1c1c)', border: '0.5px solid rgba(255,255,255,0.1)', fontSize: 14, color: 'rgba(255,255,255,0.85)' }}>
                        {CREATOR_TYPES.map(ty => <option key={ty} value={ty}>{ty}</option>)}
                      </select>
                    </div>
                  </div>
                )}

                {selectedCreator && mode !== 'new_creator' && mode !== 'existing_gallery' && !selectedCreator.source_folder && (
                  <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)', lineHeight: 1.4 }}>
                    {t('This creator has no folder set — it will be auto-detected from where their files live (or created under the new-creator base).')}
                  </div>
                )}
              </div>

              {/* Footer actions */}
              <div className="flex flex-col gap-2 p-4 flex-shrink-0" style={{ borderTop: '0.5px solid rgba(255,255,255,0.07)' }}>
                <button onMouseDown={doCommit} disabled={selected.size === 0 || busy}
                        className="w-full flex items-center justify-center gap-2 py-2.5 rounded-[10px] cursor-pointer disabled:opacity-40"
                        style={{ background: 'var(--accent)', color: '#fff', fontSize: 15, fontWeight: 600 }}>
                  {busy ? <Loader2 size={16} className="animate-spin" /> : <ArrowRight size={16} />}
                  {t('Sort')} {selected.size > 0 ? `(${selected.size})` : ''}
                </button>
                {selected.size > 0 && (
                  <div className="flex gap-2">
                    <button onMouseDown={() => doDiscard(false)}
                            className="flex-1 py-2 rounded-[8px] cursor-pointer"
                            style={{ background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.55)', fontSize: 13 }}>
                      {t('Remove from list')}
                    </button>
                    <button onMouseDown={() => doDiscard(true)}
                            className="py-2 px-3 rounded-[8px] cursor-pointer"
                            style={{ background: 'color-mix(in srgb, var(--c-pink) 12%, transparent)', color: 'color-mix(in srgb, var(--c-pink) 70%, white)', fontSize: 13 }}
                            title={t('Delete files from disk')}>
                      <Trash2 size={15} />
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {conflict && (
        <ConflictDialog dupes={conflict} total={selected.size} t={t}
                        onPick={resolveConflict} onCancel={() => setConflict(null)} />
      )}
      {archiveItem && (
        <ArchivePreview item={archiveItem} t={t} onClose={() => setArchiveItem(null)} />
      )}
    </div>,
    document.body,
  )
}

// ── Duplicate conflict resolution ─────────────────────────────────────────────
function ConflictDialog({ dupes, total, t, onPick, onCancel }) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center animate-fade-in"
         style={{ background: 'rgba(0,0,0,0.6)' }}
         onMouseDown={e => { if (e.target === e.currentTarget) onCancel() }}>
      <div className="rounded-[14px] p-5 animate-modal-pop flex flex-col gap-3"
           style={{ width: 'min(480px, 90vw)', background: 'var(--c-card, #1a1a1a)', border: '0.5px solid rgba(255,255,255,0.12)' }}>
        <div className="flex items-center gap-2">
          <AlertTriangle size={18} style={{ color: 'var(--c-amber)' }} />
          <div style={{ fontSize: 16, fontWeight: 600, color: 'rgba(255,255,255,0.9)' }}>
            {dupes.length} {t('of')} {total} {t('look like duplicates')}
          </div>
        </div>
        <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.5)', lineHeight: 1.45 }}>
          {t('These files closely match something already in your vault:')}
        </div>
        <div className="rounded-[8px] overflow-y-auto" style={{ maxHeight: 140, border: '0.5px solid rgba(255,255,255,0.07)' }}>
          {dupes.map(d => (
            <div key={d.id} className="flex items-center gap-2 px-3 py-1.5">
              {d.thumb
                ? <img src={d.thumb} alt="" className="rounded" style={{ width: 30, height: 30, objectFit: 'cover' }} />
                : <FileIcon size={16} style={{ color: 'rgba(255,255,255,0.35)' }} />}
              <span className="truncate" style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)' }}>{d.filename}</span>
            </div>
          ))}
        </div>
        <div className="flex flex-col gap-2 mt-1">
          <button onMouseDown={() => onPick('skip')} className="w-full py-2.5 rounded-[10px] cursor-pointer"
                  style={{ background: 'var(--accent)', color: '#fff', fontSize: 14, fontWeight: 600 }}>
            {t('Skip duplicates — sort the rest')}
          </button>
          <button onMouseDown={() => onPick('all')} className="w-full py-2.5 rounded-[10px] cursor-pointer"
                  style={{ background: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.75)', fontSize: 14 }}>
            {t('Sort everything anyway (keep both copies)')}
          </button>
          <button onMouseDown={() => onPick('delete')} className="w-full py-2.5 rounded-[10px] cursor-pointer"
                  style={{ background: 'color-mix(in srgb, var(--c-pink) 12%, transparent)', color: 'color-mix(in srgb, var(--c-pink) 70%, white)', fontSize: 14 }}>
            {t('Delete duplicates from disk — sort the rest')}
          </button>
          <button onMouseDown={onCancel} className="w-full py-2 cursor-pointer"
                  style={{ background: 'transparent', color: 'rgba(255,255,255,0.4)', fontSize: 13 }}>
            {t('Cancel')}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Archive contents preview ──────────────────────────────────────────────────
function ArchivePreview({ item, t, onClose }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['intake-archive', item.id],
    queryFn: () => intakeApi.archiveContents(item.id).then(r => r.data),
  })
  const counts = data?.counts
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center animate-fade-in"
         style={{ background: 'rgba(0,0,0,0.6)' }}
         onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="rounded-[14px] animate-modal-pop flex flex-col overflow-hidden"
           style={{ width: 'min(640px, 92vw)', maxHeight: '80vh', background: 'var(--c-card, #1a1a1a)', border: '0.5px solid rgba(255,255,255,0.12)' }}>
        <div className="flex items-center gap-2.5 px-4 py-3 flex-shrink-0" style={{ borderBottom: '0.5px solid rgba(255,255,255,0.07)' }}>
          <FileArchive size={16} style={{ color: 'var(--c-amber)' }} />
          <span className="flex-1 truncate" style={{ fontSize: 15, fontWeight: 600, color: 'rgba(255,255,255,0.85)' }}>{item.filename}</span>
          {counts && (
            <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.45)' }}>
              {counts.images} <ImageIcon size={12} style={{ display: 'inline' }} /> · {counts.videos} <Film size={12} style={{ display: 'inline' }} /> · {counts.other} {t('other')}
            </span>
          )}
          <button onMouseDown={onClose} className="cursor-pointer" style={{ color: 'rgba(255,255,255,0.35)' }}><X size={16} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
          {isLoading && (
            <div className="flex items-center justify-center py-10" style={{ color: 'rgba(255,255,255,0.4)' }}>
              <Loader2 size={22} className="animate-spin" />
            </div>
          )}
          {(error || (data && !data.supported)) && (
            <div style={{ fontSize: 14, color: 'color-mix(in srgb, var(--c-pink) 70%, white)' }}>
              {data?.error || t('Could not read this archive.')}
            </div>
          )}
          {data?.supported && data.can_preview && data.preview_names?.length > 0 && (
            <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))' }}>
              {data.preview_names.map(n => (
                <img key={n} src={intakeApi.archivePreviewUrl(item.id, n)} alt={n} loading="lazy"
                     className="rounded-[8px] w-full object-cover"
                     style={{ aspectRatio: '1', background: 'var(--c-bg, #0e0e0e)', border: '0.5px solid rgba(255,255,255,0.08)' }} />
              ))}
            </div>
          )}
          {data?.supported && (
            <div className="rounded-[8px]" style={{ border: '0.5px solid rgba(255,255,255,0.07)' }}>
              {data.entries.filter(e => e.kind !== 'dir').map(e => (
                <div key={e.name} className="flex items-center gap-2 px-3 py-1.5" style={{ borderBottom: '0.5px solid rgba(255,255,255,0.04)' }}>
                  {e.kind === 'image' ? <ImageIcon size={13} style={{ color: 'var(--c-green)', flexShrink: 0 }} />
                   : e.kind === 'video' ? <Film size={13} style={{ color: 'var(--c-pink)', flexShrink: 0 }} />
                   : <FileIcon size={13} style={{ color: 'rgba(255,255,255,0.35)', flexShrink: 0 }} />}
                  <span className="flex-1 truncate" style={{ fontSize: 13, color: 'rgba(255,255,255,0.65)' }}>{e.name}</span>
                  <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.3)', flexShrink: 0 }}>{fmtSize(e.size)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Grid tile: thumbnail + selection + hover archive preview ────────────────
function IntakeTile({ it, idx, on, t, onToggle, onPeek }) {
  const hoverTimer = useRef(null)
  const tileRef = useRef(null)
  const [showHover, setShowHover] = useState(false)

  const startHover = () => {
    if (!it.is_archive) return
    clearTimeout(hoverTimer.current)
    hoverTimer.current = setTimeout(() => setShowHover(true), 1000)
  }
  const endHover = () => {
    clearTimeout(hoverTimer.current)
    setShowHover(false)
  }
  useEffect(() => () => clearTimeout(hoverTimer.current), [])

  return (
    <button ref={tileRef} onMouseDown={e => onToggle(idx, it.id, e)}
            onMouseEnter={startHover} onMouseLeave={endHover}
            className="intake-tile relative rounded-[10px] overflow-hidden text-left cursor-pointer"
            style={{ border: on ? '2px solid var(--accent)' : '0.5px solid rgba(255,255,255,0.1)',
                     background: 'var(--c-card, #1c1c1c)',
                     animationDelay: `${Math.min(idx, 40) * 12}ms` }}>
      <div className="relative flex items-center justify-center" style={{ aspectRatio: '1', background: 'var(--c-bg, #0e0e0e)' }}>
        {it.thumb
          ? <img src={it.thumb} alt="" className="w-full h-full object-cover" style={{ opacity: on ? 1 : 0.9 }} />
          : <FileArchive size={30} style={{ color: 'rgba(255,255,255,0.3)' }} />}
        {it.is_video && <Film size={14} style={{ position: 'absolute', top: 6, left: 6, color: '#fff', filter: 'drop-shadow(0 1px 2px #000)' }} />}
        {it.is_archive && <FileArchive size={14} style={{ position: 'absolute', top: 6, left: 6, color: 'var(--c-amber)', filter: 'drop-shadow(0 1px 2px #000)' }} />}
        {it.has_funscript && <span style={{ position: 'absolute', top: 6, right: 6, fontSize: 11, fontWeight: 700, color: 'var(--c-pink)', background: 'rgba(0,0,0,0.6)', padding: '1px 4px', borderRadius: 4 }}>FS</span>}
        {it.duplicate_of && (
          <span title={t('A very similar file already exists in the vault')}
                style={{ position: 'absolute', bottom: 6, left: 6, fontSize: 11, fontWeight: 700,
                         color: 'var(--c-amber)', background: 'rgba(0,0,0,0.65)', padding: '1px 5px',
                         borderRadius: 4, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
            <AlertTriangle size={10} /> DUP
          </span>
        )}
        {it.is_archive && (
          <span role="button" title={t('Peek inside archive')}
                onMouseDown={e => { e.stopPropagation(); onPeek() }}
                style={{ position: 'absolute', top: 6, right: 6, cursor: 'pointer',
                         background: 'rgba(0,0,0,0.65)', borderRadius: 6, padding: 4,
                         color: 'var(--c-amber)', display: 'inline-flex' }}>
            <Eye size={13} />
          </span>
        )}
        {on && (
          <div style={{ position: 'absolute', bottom: 6, right: 6, background: 'var(--accent)', borderRadius: '50%', padding: 2 }}>
            <Check size={12} color="#fff" />
          </div>
        )}
      </div>
      <div className="px-2 py-1.5">
        <div className="truncate" style={{ fontSize: 13, color: 'rgba(255,255,255,0.75)' }} title={it.filename}>{it.filename}</div>
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)' }}>{fmtSize(it.file_size)}</div>
      </div>
      {showHover && <ArchiveHoverPreview item={it} t={t} anchorRef={tileRef} />}
    </button>
  )
}

// ── Hover popover: quick peek at archive contents without opening the modal ──
function ArchiveHoverPreview({ item, t, anchorRef }) {
  const { data, isLoading } = useQuery({
    queryKey: ['intake-archive', item.id],
    queryFn: () => intakeApi.archiveContents(item.id).then(r => r.data),
  })
  const [pos, setPos] = useState({ left: 0, top: 0, flip: false })

  useEffect(() => {
    const el = anchorRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const popW = 280
    const spaceRight = window.innerWidth - rect.right
    const flip = spaceRight < popW + 20
    setPos({
      left: flip ? rect.left - popW - 8 : rect.right + 8,
      top: Math.min(rect.top, window.innerHeight - 340),
      flip,
    })
  }, [anchorRef])

  const counts = data?.counts

  return createPortal(
    <div onMouseDown={e => e.stopPropagation()}
         className="fixed z-[70] rounded-[10px] overflow-hidden animate-fade-in pointer-events-none"
         style={{ left: pos.left, top: Math.max(8, pos.top), width: 280, maxHeight: 320,
                  background: 'var(--c-card, #1a1a1a)', border: '0.5px solid rgba(255,255,255,0.14)',
                  boxShadow: '0 10px 30px rgba(0,0,0,0.5)' }}>
      <div className="flex items-center gap-2 px-3 py-2" style={{ borderBottom: '0.5px solid rgba(255,255,255,0.07)' }}>
        <FileArchive size={13} style={{ color: 'var(--c-amber)', flexShrink: 0 }} />
        <span className="flex-1 truncate" style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.85)' }}>{item.filename}</span>
      </div>
      <div className="p-3 flex flex-col gap-2 overflow-y-auto" style={{ maxHeight: 270 }}>
        {isLoading && (
          <div className="flex items-center justify-center py-6" style={{ color: 'rgba(255,255,255,0.4)' }}>
            <Loader2 size={16} className="animate-spin" />
          </div>
        )}
        {data && !data.supported && (
          <div style={{ fontSize: 12, color: 'color-mix(in srgb, var(--c-pink) 70%, white)' }}>
            {data.error || t('Could not read this archive.')}
          </div>
        )}
        {counts && (
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>
            {counts.images} <ImageIcon size={11} style={{ display: 'inline' }} /> · {counts.videos} <Film size={11} style={{ display: 'inline' }} /> · {counts.other} {t('other')}
          </div>
        )}
        {data?.supported && data.can_preview && data.preview_names?.length > 0 && (
          <div className="grid gap-1.5" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
            {data.preview_names.slice(0, 12).map(n => (
              <img key={n} src={intakeApi.archivePreviewUrl(item.id, n)} alt="" loading="lazy"
                   className="rounded-[5px] w-full object-cover"
                   style={{ aspectRatio: '1', background: 'var(--c-bg, #0e0e0e)', border: '0.5px solid rgba(255,255,255,0.08)' }} />
            ))}
          </div>
        )}
        {data?.supported && data.entries?.length > 0 && (
          <div className="flex flex-col gap-0.5">
            {data.entries.filter(e => e.kind !== 'dir').slice(0, 10).map(e => (
              <div key={e.name} className="truncate" style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)' }}>{e.name}</div>
            ))}
            {data.entries.filter(e => e.kind !== 'dir').length > 10 && (
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)' }}>
                +{data.entries.filter(e => e.kind !== 'dir').length - 10} {t('more')}
              </div>
            )}
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}

function ModeRow({ icon: Icon, label, active, onPick }) {
  return (
    <button onMouseDown={onPick}
            className="flex items-center gap-2.5 px-3 py-2 rounded-[8px] cursor-pointer transition-all"
            style={{ background: active ? 'color-mix(in srgb, var(--accent) 15%, transparent)' : 'rgba(255,255,255,0.03)',
                     border: `0.5px solid ${active ? 'color-mix(in srgb, var(--accent) 35%, transparent)' : 'rgba(255,255,255,0.06)'}`,
                     color: active ? 'color-mix(in srgb, var(--accent) 85%, white)' : 'rgba(255,255,255,0.6)', fontSize: 14 }}>
      <Icon size={15} />{label}
    </button>
  )
}

// ── Settings pane: intake folders + new-creator base + archive toggle ─────────
function IntakeSettings({ roots, onAddRoot, qc, t }) {
  const { data: cfg } = useQuery({
    queryKey: ['intake-config'],
    queryFn: () => intakeApi.getConfig().then(r => r.data),
  })
  const [base, setBase] = useState('')
  const [extract, setExtract] = useState(true)
  const [archiveAfter, setArchiveAfter] = useState('delete')
  useEffect(() => {
    if (cfg) {
      setBase(cfg.new_creator_base || '')
      setExtract(cfg.extract_archives !== false)
      setArchiveAfter(cfg.archive_after || 'delete')
    }
  }, [cfg])

  const save = async (patch) => {
    try {
      const { data } = await intakeApi.setConfig(patch)
      setBase(data.new_creator_base || '')
      setExtract(data.extract_archives !== false)
      setArchiveAfter(data.archive_after || 'delete')
      qc.invalidateQueries({ queryKey: ['intake-config'] })
    } catch { toast.error(t('Could not save setting')) }
  }

  const browseBase = async () => {
    try {
      const { data } = await scannerApi.browseFolder()
      if (data?.path) { setBase(data.path); save({ new_creator_base: data.path }) }
    } catch { toast.error(t('Could not pick folder')) }
  }

  const delRoot = async (id) => {
    try { await intakeApi.delRoot(id); qc.invalidateQueries({ queryKey: ['intake-roots'] }) }
    catch { toast.error(t('Could not remove')) }
  }

  return (
    <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-5">
      {/* Intake folders */}
      <div>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'rgba(255,255,255,0.7)', marginBottom: 8 }}>{t('Downloads / intake folders')}</div>
        <div className="flex flex-col gap-2 mb-2">
          {roots.length === 0 && <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.35)' }}>{t('No folders yet.')}</div>}
          {roots.map(r => (
            <div key={r.id} className="flex items-center gap-2 px-3 py-2 rounded-[8px]"
                 style={{ background: 'rgba(255,255,255,0.04)', border: '0.5px solid rgba(255,255,255,0.06)' }}>
              <FolderOpen size={14} style={{ color: 'var(--accent)', flexShrink: 0 }} />
              <span className="flex-1 truncate" style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)' }} title={r.path}>{r.path}</span>
              <button onMouseDown={() => delRoot(r.id)} className="cursor-pointer" style={{ color: 'rgba(255,255,255,0.3)' }}><X size={14} /></button>
            </div>
          ))}
        </div>
        <button onMouseDown={onAddRoot} className="flex items-center gap-2 px-3 py-2 rounded-[8px] cursor-pointer"
                style={{ background: 'color-mix(in srgb, var(--accent) 12%, transparent)', color: 'color-mix(in srgb, var(--accent) 85%, white)', fontSize: 14, border: '0.5px solid color-mix(in srgb, var(--accent) 25%, transparent)' }}>
          <FolderPlus size={15} />{t('Add folder')}
        </button>
      </div>

      {/* New-creator base */}
      <div>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'rgba(255,255,255,0.7)', marginBottom: 4 }}>{t('New-creator base folder')}</div>
        <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)', marginBottom: 8, lineHeight: 1.4 }}>
          {t('When you sort files to a brand-new creator, their folder is created here.')}
        </div>
        <div className="flex items-center gap-2 px-3 py-2 rounded-[8px]"
             style={{ background: 'rgba(255,255,255,0.04)', border: '0.5px solid rgba(255,255,255,0.06)' }}>
          <span className="flex-1 truncate" style={{ fontSize: 13, color: base ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.3)' }}>
            {base || t('Not set')}
          </span>
          <button onMouseDown={browseBase} className="cursor-pointer px-2 py-1 rounded-[6px]"
                  style={{ background: 'color-mix(in srgb, var(--accent) 15%, transparent)', color: 'color-mix(in srgb, var(--accent) 85%, white)', fontSize: 13 }}>{t('Browse')}</button>
        </div>
      </div>

      {/* Archive extraction */}
      <div>
        <label className="flex items-center gap-3 cursor-pointer mb-3">
          <input type="checkbox" checked={extract} onChange={e => save({ extract_archives: e.target.checked })} />
          <div>
            <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.75)' }}>{t('Extract archives into destination')}</div>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>{t('.zip / .rar / .7z are unpacked into their own folder when sorted.')}</div>
          </div>
        </label>

        <div style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.6)', marginBottom: 6 }}>
          {t('When an archive is extracted, the original file should:')}
        </div>
        <select value={archiveAfter} onChange={e => save({ archive_after: e.target.value })}
                className="w-full px-3 py-2 rounded-[8px] outline-none cursor-pointer"
                style={{ background: 'var(--c-card, #1c1c1c)', border: '0.5px solid rgba(255,255,255,0.1)', fontSize: 14, color: 'rgba(255,255,255,0.85)' }}>
          <option value="delete">{t('Be deleted')}</option>
          <option value="move">{t('Be moved into the destination folder')}</option>
          <option value="keep">{t('Be left where it is')}</option>
        </select>
      </div>
    </div>
  )
}

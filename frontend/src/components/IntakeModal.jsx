import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle, ArrowRight, Check, Eye, FileArchive, Film, FolderOpen,
  FolderPlus, Inbox, Loader2, RefreshCw, Search,
  Settings, ShieldCheck, SlidersHorizontal, Trash2, X,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { creatorsApi, galleriesApi, intakeApi, scannerApi } from '../lib/api'
import { useT } from '../i18n'
import InlineVideoPlayer from './InlineVideoPlayer'
import FolderPicker from './FolderPicker'

const CREATOR_TYPES = ['cosplayer', 'ethot', 'artist', 'character', 'actress', 'custom']
const text = { fontSize: 16 }

function fmtSize(bytes) {
  if (!bytes && bytes !== 0) return ''
  const mb = bytes / (1024 * 1024)
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`
  if (mb >= 1) return `${mb.toFixed(1)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

function fmtDuration(seconds) {
  if (seconds === null || seconds === undefined || !Number.isFinite(Number(seconds))) return null
  const total = Math.round(Number(seconds))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const rest = total % 60
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}` : `${minutes}:${String(rest).padStart(2, '0')}`
}

function mediaFacts(media) {
  return [
    media?.width && media?.height ? `${media.width} × ${media.height}` : null,
    fmtSize(media?.file_size),
    media?.is_video ? fmtDuration(media?.duration) : null,
  ].filter(Boolean)
}

function normList(data) {
  if (Array.isArray(data)) return data
  return data?.items ?? data?.creators ?? data?.galleries ?? []
}

function useSentinel(enabled, onHit) {
  const ref = useRef(null)
  useEffect(() => {
    if (!enabled || !ref.current) return
    const observer = new IntersectionObserver(([entry]) => entry.isIntersecting && onHit(), { rootMargin: '300px' })
    observer.observe(ref.current)
    return () => observer.disconnect()
  }, [enabled, onHit])
  return ref
}

export default function IntakeModal({ onClose }) {
  const t = useT()
  const qc = useQueryClient()
  const [tab, setTab] = useState('files')
  const [selected, setSelected] = useState(() => new Set())
  const [lastIdx, setLastIdx] = useState(null)
  const [scanning, setScanning] = useState(false)
  const [busy, setBusy] = useState(false)
  const [job, setJob] = useState(null)
  const [report, setReport] = useState(null)
  const [importError, setImportError] = useState('')
  const [showSettings, setShowSettings] = useState(false)
  const [preview, setPreview] = useState(null)
  const [duplicate, setDuplicate] = useState(null)
  const [archive, setArchive] = useState(null)
  const [folderPreview, setFolderPreview] = useState(null)

  const [typeFilter, setTypeFilter] = useState('all')
  const [duplicateFilter, setDuplicateFilter] = useState('all')
  const [nameSearch, setNameSearch] = useState('')
  const [sortField, setSortField] = useState('date')
  const [sortDir, setSortDir] = useState('desc')

  const [creatorId, setCreatorId] = useState(null)
  const [mode, setMode] = useState('creator_root')
  const [folderName, setFolderName] = useState('')
  const [galleryId, setGalleryId] = useState(null)
  const [newName, setNewName] = useState('')
  const [newType, setNewType] = useState('cosplayer')
  const [creatorSearch, setCreatorSearch] = useState('')
  const [gallerySearch, setGallerySearch] = useState('')
  const [folderConflict, setFolderConflict] = useState('rename')

  const { data: roots = [] } = useQuery({
    queryKey: ['intake-roots'], queryFn: () => intakeApi.roots().then(r => r.data),
  })
  const fileParams = { kind: typeFilter, search: nameSearch, duplicates: duplicateFilter,
    sort: sortField, direction: sortDir, limit: 120 }
  const filesQuery = useInfiniteQuery({
    queryKey: ['intake-items', fileParams],
    queryFn: ({ pageParam = 1 }) => intakeApi.items({ ...fileParams, page: pageParam }).then(r => r.data),
    initialPageParam: 1,
    getNextPageParam: page => page.has_more ? page.page + 1 : undefined,
  })
  const foldersQuery = useInfiniteQuery({
    queryKey: ['intake-folders', nameSearch, sortField, sortDir],
    queryFn: ({ pageParam = 1 }) => intakeApi.folders({ page: pageParam, limit: 60,
      search: nameSearch, sort: sortField, direction: sortDir }).then(r => r.data),
    initialPageParam: 1,
    getNextPageParam: page => page.has_more ? page.page + 1 : undefined,
  })
  const activeQuery = tab === 'files' ? filesQuery : foldersQuery
  const items = activeQuery.data?.pages.flatMap(page => page.items) ?? []
  const total = activeQuery.data?.pages[0]?.total ?? 0
  const sentinel = useSentinel(activeQuery.hasNextPage && !activeQuery.isFetchingNextPage,
    () => activeQuery.fetchNextPage())

  const { data: status } = useQuery({
    queryKey: ['intake-status'], queryFn: () => intakeApi.status().then(r => r.data),
    refetchInterval: scanning || busy ? 1000 : false,
  })
  const { data: creators = [] } = useQuery({
    queryKey: ['creators-all'], queryFn: () => creatorsApi.list({ limit: 2000 }).then(r => normList(r.data)),
  })
  const { data: galleries = [] } = useQuery({
    queryKey: ['creator-galleries', creatorId],
    queryFn: () => galleriesApi.list({ creator_id: creatorId, limit: 1000 }).then(r => normList(r.data)),
    enabled: mode === 'existing_gallery' && !!creatorId,
  })

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['intake-items'] })
    qc.invalidateQueries({ queryKey: ['intake-folders'] })
  }
  useEffect(() => {
    if (!job || status?.done_job_id !== job.id) return
    setScanning(false)
    setBusy(false)
    const results = status.report || []
    const failed = results.filter(row => row.result === 'error')
    const error = status.message?.match(/^(?:Commit error|Gallery import error):\s*(.*)$/)?.[1]
    setReport(results.length ? results : null)
    setImportError(error || (failed.length ? failed.map(row => `${row.filename}: ${row.message}`).join('\n') : ''))
    if (!error && !failed.length) setSelected(new Set())
    setJob(null)
    refresh()
    qc.invalidateQueries({ queryKey: ['galleries'] })
    qc.invalidateQueries({ queryKey: ['creators'] })
  }, [job, status]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { setSelected(new Set()); setLastIdx(null) }, [tab, typeFilter, duplicateFilter, nameSearch, sortField, sortDir])

  const filteredCreators = useMemo(() => {
    const q = creatorSearch.trim().toLowerCase()
    return creators.filter(c => !q || c.name?.toLowerCase().includes(q)).slice(0, 50)
  }, [creators, creatorSearch])
  const filteredGalleries = useMemo(() => {
    const q = gallerySearch.trim().toLowerCase()
    return galleries.filter(g => !q || g.name?.toLowerCase().includes(q))
  }, [galleries, gallerySearch])

  const toggle = (idx, id, event) => {
    setSelected(previous => {
      const next = new Set(previous)
      if (event.shiftKey && lastIdx !== null) {
        for (let n = Math.min(lastIdx, idx); n <= Math.max(lastIdx, idx); n += 1) next.add(items[n].id)
      } else next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
    setLastIdx(idx)
  }

  const buildTarget = () => {
    if (mode === 'unsorted') return { mode: 'unsorted', folder_conflict: folderConflict }
    if (mode === 'new_creator') {
      if (!newName.trim()) { toast.error(t('Enter a name for the new creator')); return null }
      return { mode, new_creator: { name: newName.trim(), creator_type: newType }, folder_conflict: folderConflict }
    }
    if (!creatorId) { toast.error(t('Pick a creator first')); return null }
    if (tab === 'galleries') return { mode: 'creator_root', creator_id: creatorId, folder_conflict: folderConflict }
    if (mode === 'new_folder' && !folderName.trim()) { toast.error(t('Enter a folder name')); return null }
    if (mode === 'existing_gallery' && !galleryId) { toast.error(t('Pick a gallery')); return null }
    return { mode, creator_id: creatorId, folder_name: folderName.trim() || undefined, gallery_id: galleryId || undefined }
  }

  const startScan = async () => {
    setScanning(true); setReport(null)
    try { const { data } = await intakeApi.scan(); setJob({ id: data.job_id }) }
    catch (error) { setScanning(false); toast.error(error?.response?.data?.detail || t('Failed to start scan')) }
  }
  const commit = async () => {
    if (!selected.size) return
    const target = buildTarget()
    if (!target) return
    if (tab === 'files') {
      const duplicateCount = items.filter(item => selected.has(item.id) && item.duplicate).length
      if (duplicateCount && !window.confirm(
        `${duplicateCount} ${t('selected file(s) already match something in the vault.')}\n\n${t('Import them anyway? Use the duplicate filters if you want to ignore or delete them first.')}`)) return
    }
    setBusy(true); setReport(null); setImportError('')
    try {
      const ids = [...selected]
      const { data } = tab === 'galleries'
        ? await intakeApi.commitFolders(ids, target)
        : await intakeApi.commit(ids, target)
      setJob({ id: data.job_id })
    } catch (error) { setBusy(false); setImportError(error?.response?.data?.detail || t('Could not start import')) }
  }

  const act = async action => {
    if (!selected.size) return
    if (action === 'delete' && !window.confirm(
      `${t('Permanently delete')} ${selected.size} ${tab === 'galleries' ? t('folder(s) and everything inside them') : t('file(s)')}?\n\n${t('This cannot be undone.')}`)) return
    try {
      const { data } = tab === 'galleries'
        ? await intakeApi.discardFolders([...selected], action)
        : await intakeApi.discard([...selected], action)
      if (data.errors?.length) toast.error(`${data.errors.length} ${t('item(s) could not be changed')}`)
      else toast.success(action === 'hide' ? t('Hidden until the next scan') : action === 'ignore' ? t('Ignored permanently') : t('Deleted permanently'))
      setSelected(new Set()); refresh()
    } catch (error) { toast.error(error?.response?.data?.detail || t('Action failed')) }
  }

  const bulkDuplicates = async (action, includeVisual) => {
    const label = includeVisual ? t('every exact and visual duplicate') : t('every exact duplicate')
    if (action === 'delete' && !window.confirm(`${t('Permanently delete')} ${label} ${t('matching the current file filters')}?\n\n${includeVisual ? t('Visual matches may be resized or edited versions. Review them first if unsure.') : t('Only byte-for-byte SHA-256 matches will be deleted.')}\n\n${t('This cannot be undone.')}`)) return
    try {
      const { data } = await intakeApi.bulkDuplicates(action, includeVisual, { kind: typeFilter, search: nameSearch })
      if (data.errors?.length) toast.error(`${data.errors.length} ${t('file(s) could not be changed')}`)
      else toast.success(`${data.affected} ${t('duplicate file(s) changed')}`)
      setSelected(new Set()); refresh()
    } catch (error) { toast.error(error?.response?.data?.detail || t('Bulk action failed')) }
  }

  const running = scanning || busy
  const pct = status?.total ? Math.round(status.progress / status.total * 100) : 0
  return createPortal(
    <div className="loading-bay-backdrop fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.78)' }}>
      <div className="loading-bay-shell flex flex-col overflow-hidden rounded-2xl" style={{ width: 'min(1720px, 94vw)', height: '92vh', background: 'var(--c-surface)', border: '1px solid rgba(255,255,255,.12)' }}>
        <header className="flex items-center gap-3 px-5 py-4" style={{ borderBottom: '1px solid rgba(255,255,255,.08)' }}>
          <Inbox size={22} color="var(--accent)" />
          <div className="flex-1"><div style={{ fontSize: 20, fontWeight: 700 }}>{t('Loading Bay')}</div><div style={text}>{t('Import loose files or complete gallery folders')}</div></div>
          <button onClick={() => setShowSettings(v => !v)} className="p-2 rounded-lg" title={t('Settings')}><Settings size={20} /></button>
          <button onClick={onClose} className="p-2" title={t('Close')}><X size={22} /></button>
        </header>

        {showSettings ? <LoadingBaySettings roots={roots} refreshRoots={() => qc.invalidateQueries({ queryKey: ['intake-roots'] })} t={t} /> : (
          <div className="flex flex-1 min-h-0">
            <main className="flex flex-col flex-1 min-w-0" style={{ borderRight: '1px solid rgba(255,255,255,.08)' }}>
              <div className="flex items-center gap-2 px-4 py-3 flex-wrap">
                <button onClick={startScan} disabled={running} className="flex items-center gap-2 px-3 py-2 rounded-lg disabled:opacity-50" style={{ ...text, background: 'color-mix(in srgb,var(--c-green) 16%,transparent)' }}>
                  {scanning ? <Loader2 className="animate-spin" size={18} /> : <RefreshCw size={18} />}{t('Scan Loading Bay')}
                </button>
                {['files', 'galleries'].map(key => <button key={key} onClick={() => setTab(key)} className="px-3 py-2 rounded-lg" style={{ ...text, background: tab === key ? 'color-mix(in srgb,var(--accent) 25%,transparent)' : 'rgba(255,255,255,.05)' }}>{key === 'files' ? t('Loose files') : t('Gallery folders')}</button>)}
                {!!items.length && <button onClick={() => setSelected(selected.size === items.length ? new Set() : new Set(items.map(i => i.id)))} className="px-3 py-2 rounded-lg" style={{ ...text, background: 'rgba(255,255,255,.05)' }}>{selected.size === items.length ? t('Clear selection') : t('Select loaded')}</button>}
                <span className="ml-auto" style={text}>{selected.size ? `${selected.size} ${t('selected')} · ` : ''}{items.length} / {total}</span>
              </div>

              <LoadingBayFilters tab={tab} typeFilter={typeFilter} setTypeFilter={setTypeFilter}
                duplicateFilter={duplicateFilter} setDuplicateFilter={setDuplicateFilter}
                nameSearch={nameSearch} setNameSearch={setNameSearch} sortField={sortField}
                setSortField={setSortField} sortDir={sortDir} setSortDir={setSortDir} t={t} />

              {running && <div className="px-4 pb-3"><div className="flex justify-between" style={text}><span>{status?.message || t('Working…')}</span><span>{status?.progress || 0} / {status?.total || 0}</span></div><div className="h-2 mt-2 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,.08)' }}><div className="h-full" style={{ width: `${pct}%`, background: 'var(--accent)' }} /></div></div>}

              {tab === 'files' && duplicateFilter !== 'all' && <div className="flex gap-2 px-4 pb-3 flex-wrap">
                <button onClick={() => bulkDuplicates('ignore', duplicateFilter !== 'exact')} className="px-3 py-2 rounded-lg" style={{ ...text, background: 'rgba(255,255,255,.07)' }}>{t('Ignore all matching duplicates')}</button>
                <button onClick={() => bulkDuplicates('delete', false)} className="px-3 py-2 rounded-lg" style={{ ...text, background: 'color-mix(in srgb,var(--c-pink) 14%,transparent)' }}>{t('Delete all exact duplicates')}</button>
                {duplicateFilter !== 'exact' && <button onClick={() => bulkDuplicates('delete', true)} className="px-3 py-2 rounded-lg" style={{ ...text, color: 'var(--c-pink)', background: 'color-mix(in srgb,var(--c-pink) 10%,transparent)' }}>{t('Delete exact + visual matches')}</button>}
              </div>}

              <div className="flex-1 overflow-y-auto px-4 pb-4">
                {!activeQuery.isLoading && !items.length ? <Empty roots={roots} t={t} /> : <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(180px,1fr))' }}>
                  {items.map((item, idx) => tab === 'files'
                    ? <FileCard key={item.id} item={item} selected={selected.has(item.id)} onToggle={e => toggle(idx, item.id, e)} onPreview={() => item.is_archive ? setArchive(item) : item.duplicate ? setDuplicate(item) : setPreview(item)} onDuplicate={() => setDuplicate(item)} t={t} />
                    : <FolderCard key={item.id} item={item} selected={selected.has(item.id)} onToggle={e => toggle(idx, item.id, e)} onPreview={() => setFolderPreview(item)} t={t} />)}
                </div>}
                <div ref={sentinel} className="h-12 flex items-center justify-center">{activeQuery.isFetchingNextPage && <Loader2 className="animate-spin" />}</div>
              </div>
            </main>

            <DestinationPanel tab={tab} creators={filteredCreators} creatorId={creatorId} setCreatorId={setCreatorId}
              creatorSearch={creatorSearch} setCreatorSearch={setCreatorSearch} mode={mode} setMode={setMode}
              folderName={folderName} setFolderName={setFolderName} galleryId={galleryId} setGalleryId={setGalleryId}
              galleries={filteredGalleries} gallerySearch={gallerySearch} setGallerySearch={setGallerySearch}
              newName={newName} setNewName={setNewName} newType={newType} setNewType={setNewType}
              folderConflict={folderConflict} setFolderConflict={setFolderConflict} report={report} importError={importError}
              selectedCount={selected.size} busy={busy} onCommit={commit} onAction={act} t={t} />
          </div>
        )}
      </div>
      {preview && <MediaPreview item={preview} onClose={() => setPreview(null)} t={t} />}
      {duplicate && <DuplicateDetails item={duplicate} onClose={() => setDuplicate(null)} t={t} />}
      {archive && <ArchivePreview item={archive} onClose={() => setArchive(null)} t={t} />}
      {folderPreview && <FolderPreview folder={folderPreview} onClose={() => setFolderPreview(null)} t={t} />}
    </div>, document.body)
}

function LoadingBayFilters({ tab, typeFilter, setTypeFilter, duplicateFilter, setDuplicateFilter, nameSearch, setNameSearch, sortField, setSortField, sortDir, setSortDir, t }) {
  return <div className="flex gap-2 px-4 pb-3 flex-wrap items-center">
    <div className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ background: 'rgba(255,255,255,.05)' }}><Search size={18} /><input value={nameSearch} onChange={e => setNameSearch(e.target.value)} placeholder={tab === 'files' ? t('Search filenames…') : t('Search folder names…')} className="bg-transparent outline-none" style={{ ...text, width: 190 }} /></div>
    {tab === 'files' && <>{[['all','All'],['image','Images'],['video','Videos'],['archive','Archives']].map(([key,label]) => <Chip key={key} active={typeFilter === key} onClick={() => setTypeFilter(key)}>{t(label)}</Chip>)}
      <SlidersHorizontal size={18} />{[['all','Any duplicate status'],['duplicates','Duplicates only'],['exact','Exact duplicates'],['visual','Visual matches']].map(([key,label]) => <Chip key={key} active={duplicateFilter === key} onClick={() => setDuplicateFilter(key)}>{t(label)}</Chip>)}</>}
    <span className="flex-1" />
    {[['date','Date'],['size','Size'],['name','Name']].map(([key,label]) => <Chip key={key} active={sortField === key} onClick={() => sortField === key ? setSortDir(sortDir === 'asc' ? 'desc' : 'asc') : setSortField(key)}>{t(label)}{sortField === key ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}</Chip>)}
  </div>
}

function Chip({ active, onClick, children }) {
  return <button onClick={onClick} className="px-3 py-2 rounded-full" style={{ ...text, background: active ? 'color-mix(in srgb,var(--accent) 24%,transparent)' : 'rgba(255,255,255,.05)', border: `1px solid ${active ? 'color-mix(in srgb,var(--accent) 45%,transparent)' : 'rgba(255,255,255,.08)'}` }}>{children}</button>
}

function FileCard({ item, selected, onToggle, onPreview, onDuplicate, t }) {
  return <div onMouseDown={onToggle} className="loading-bay-card relative rounded-xl overflow-hidden cursor-pointer" style={{ border: selected ? '2px solid var(--accent)' : '1px solid rgba(255,255,255,.1)', background: 'var(--c-card)' }}>
    <div className="relative aspect-square flex items-center justify-center" style={{ background: 'var(--c-bg)' }}>{item.thumb ? <img src={item.thumb} alt="" className="w-full h-full object-cover" /> : <FileArchive size={40} />}
      {item.is_video && <Film size={20} className="absolute top-2 left-2" />}
      {item.is_archive && <FileArchive size={20} className="absolute top-2 left-2" />}
      <button onMouseDown={e => { e.stopPropagation(); onPreview() }} className="absolute top-2 right-2 p-2 rounded-lg" style={{ background: 'rgba(0,0,0,.72)' }} title={item.is_video ? t('Play video') : t('Preview')}><Eye size={18} /></button>
      {item.duplicate && <button onMouseDown={e => { e.stopPropagation(); onDuplicate() }} className="absolute bottom-2 left-2 px-2 py-1 rounded-lg flex items-center gap-1" style={{ ...text, background: 'rgba(0,0,0,.78)', color: item.duplicate.safe_to_auto_delete ? 'var(--c-green)' : 'var(--c-amber)' }}><AlertTriangle size={16} />{item.duplicate.safe_to_auto_delete ? t('EXACT') : t('VISUAL')}</button>}
      {selected && <span className="absolute bottom-2 right-2 rounded-full p-1" style={{ background: 'var(--accent)' }}><Check size={18} /></span>}
    </div><div className="p-2"><div className="truncate" title={item.filename} style={text}>{item.filename}</div><div style={{ ...text, opacity: .55 }}>{fmtSize(item.file_size)}</div></div>
  </div>
}

function FolderCard({ item, selected, onToggle, onPreview, t }) {
  const previews = item.preview_thumbs || (item.thumb ? [item.thumb] : [])
  const [hovered, setHovered] = useState(false)
  const [frame, setFrame] = useState(0)
  useEffect(() => {
    if (!hovered || previews.length < 2) return undefined
    const timer = setInterval(() => setFrame(value => (value + 1) % previews.length), 850)
    return () => clearInterval(timer)
  }, [hovered, previews.length])
  return <div onMouseDown={onToggle} onMouseEnter={() => setHovered(true)} onMouseLeave={() => { setHovered(false); setFrame(0) }} className="loading-bay-card rounded-xl overflow-hidden cursor-pointer" style={{ border: selected ? '2px solid var(--accent)' : '1px solid rgba(255,255,255,.1)', background: 'var(--c-card)' }}>
    <div className="relative aspect-[4/3] flex items-center justify-center overflow-hidden" style={{ background: 'var(--c-bg)' }}>
      {previews.length ? <img key={previews[frame]} src={previews[frame]} alt="" className="w-full h-full object-cover" /> : <div className="flex flex-col items-center gap-2 px-4 text-center" style={{ ...text, opacity: .72 }}><FolderOpen size={48} /><span>{t('No cover generated')}</span></div>}
      {previews.length > 1 && <span className="absolute bottom-2 left-2 px-2 py-1 rounded-lg" style={{ ...text, background: 'rgba(0,0,0,.72)' }}>{frame + 1} / {previews.length}</span>}
      <button onMouseDown={event => { event.stopPropagation(); onPreview() }} className="absolute top-2 right-2 p-2 rounded-lg flex items-center gap-2" style={{ ...text, background: 'rgba(0,0,0,.78)' }} title={t('Open gallery contents')}><Eye size={18} /><span>{t('Open')}</span></button>
      {selected && <span className="absolute bottom-2 right-2 rounded-full p-1" style={{ background: 'var(--accent)' }}><Check size={18} /></span>}
    </div>
    <div className="p-3"><div className="truncate font-semibold" style={text}>{item.name}</div><div style={{ ...text, opacity: .6 }}>{item.file_count} {t('files')} · {item.video_count} {t('videos')} · {fmtSize(item.total_size)}</div>{item.preview_reason && <div className="mt-1 line-clamp-2" title={item.preview_reason} style={{ ...text, color: 'var(--c-amber)' }}>{item.preview_reason}</div>}{item.duplicate_count > 0 && <div style={{ ...text, color: 'var(--c-amber)' }}>{item.exact_duplicate_count} {t('exact')} · {item.visual_duplicate_count} {t('visual matches')}</div>}</div>
  </div>
}

function DestinationPanel(props) {
  const qc = useQueryClient()
  const { tab, creators, creatorId, setCreatorId, creatorSearch, setCreatorSearch, mode, setMode,
    folderName, setFolderName, galleryId, setGalleryId, galleries, gallerySearch, setGallerySearch,
    newName, setNewName, newType, setNewType, folderConflict, setFolderConflict, report, importError,
    selectedCount, busy, onCommit, onAction, t } = props
  const [choosingBase, setChoosingBase] = useState(false)
  const { data: intakeConfig } = useQuery({ queryKey: ['intake-config'], queryFn: () => intakeApi.getConfig().then(r => r.data) })
  const saveCreatorBase = async path => {
    await intakeApi.setConfig({ new_creator_base: path })
    await qc.invalidateQueries({ queryKey: ['intake-config'] })
  }
  return <aside className="w-[410px] flex-shrink-0 flex flex-col"><div className="flex-1 overflow-y-auto p-4 space-y-4">
    {importError && <div role="alert" className="p-3 rounded-lg whitespace-pre-wrap break-words" style={{ ...text, color: 'var(--c-pink)', background: 'color-mix(in srgb,var(--c-pink) 12%,transparent)' }}>{importError}</div>}
    {report && <div className="p-3 rounded-lg" style={{ ...text, background: 'color-mix(in srgb,var(--c-green) 12%,transparent)' }}>{report.filter(r => r.result !== 'error').length} {t('completed')}{report.some(r => r.result === 'error') && ` · ${report.filter(r => r.result === 'error').length} ${t('failed')}`}</div>}
    <div className="font-semibold" style={text}>{t('Import destination')}</div>
    <button onClick={() => setMode('unsorted')} className="w-full text-left p-4 rounded-xl" style={{ ...text, background: mode === 'unsorted' ? 'color-mix(in srgb,var(--accent) 22%,transparent)' : 'rgba(255,255,255,.05)', border: `1px solid ${mode === 'unsorted' ? 'var(--accent)' : 'rgba(255,255,255,.1)'}` }}><div className="font-semibold flex items-center gap-2"><Inbox size={20} />{t('Import as unsorted')}</div><div className="mt-1" style={{ opacity: .65 }}>{t('No creator assignment. Move everything into your Unsorted folder and register it in the Vault.')}</div></button>
    {mode === 'unsorted' && <div className="p-3 rounded-lg break-all" style={{ ...text, color: intakeConfig?.unsorted_folder ? 'var(--c-green)' : 'var(--c-amber)', background: 'rgba(255,255,255,.04)' }}>{intakeConfig?.unsorted_folder ? <>{t('Destination:')} {intakeConfig.unsorted_folder}</> : t('Set an Unsorted folder in Loading Bay settings before importing.')}</div>}
    {mode !== 'new_creator' && mode !== 'unsorted' && <><div className="flex gap-2 px-3 py-2 rounded-lg" style={{ background: 'rgba(255,255,255,.05)' }}><Search size={18} /><input value={creatorSearch} onChange={e => setCreatorSearch(e.target.value)} placeholder={t('Search creators…')} className="bg-transparent outline-none flex-1" style={text} /></div><div className="max-h-48 overflow-y-auto rounded-lg">{creators.map(c => <button key={c.id} onClick={() => { setCreatorId(c.id); setGalleryId(null) }} className="w-full text-left px-3 py-2" style={{ ...text, background: creatorId === c.id ? 'color-mix(in srgb,var(--accent) 20%,transparent)' : 'transparent' }}>{c.name}</button>)}</div></>}
    <div className="grid grid-cols-2 gap-2">{[['creator_root','Creator root'],['new_creator','New creator'], ...(tab === 'files' ? [['new_folder','New gallery'],['existing_gallery','Existing gallery']] : [])].map(([key,label]) => <Chip key={key} active={mode === key} onClick={() => setMode(key)}>{t(label)}</Chip>)}</div>
    {mode === 'new_folder' && <input value={folderName} onChange={e => setFolderName(e.target.value)} placeholder={t('Gallery folder name…')} className="w-full px-3 py-2 rounded-lg" style={{ ...text, background: 'rgba(255,255,255,.05)' }} />}
    {mode === 'existing_gallery' && <><input value={gallerySearch} onChange={e => setGallerySearch(e.target.value)} placeholder={t('Search galleries…')} className="w-full px-3 py-2 rounded-lg" style={{ ...text, background: 'rgba(255,255,255,.05)' }} /><div className="max-h-48 overflow-y-auto">{galleries.map(g => <button key={g.id} onClick={() => setGalleryId(g.id)} className="w-full text-left px-3 py-2" style={{ ...text, background: galleryId === g.id ? 'color-mix(in srgb,var(--accent) 20%,transparent)' : 'transparent' }}>{g.name}</button>)}</div></>}
    {mode === 'new_creator' && <><input value={newName} onChange={e => setNewName(e.target.value)} placeholder={t('New creator name…')} className="w-full px-3 py-2 rounded-lg" style={{ ...text, background: 'rgba(255,255,255,.05)' }} /><select value={newType} onChange={e => setNewType(e.target.value)} className="w-full px-3 py-2 rounded-lg" style={{ ...text, background: 'var(--c-card)' }}>{CREATOR_TYPES.map(type => <option key={type}>{type}</option>)}</select><div className="p-3 rounded-lg break-all" style={{ ...text, background: 'rgba(255,255,255,.04)' }}><div>{t('New creator base folder')}</div><div style={{ color: intakeConfig?.new_creator_base ? 'var(--c-green-text)' : 'var(--c-amber)' }}>{intakeConfig?.new_creator_base || t('Choose where new creator folders will be made.')}</div><button onClick={() => setChoosingBase(true)} disabled={busy} className="mt-2 px-3 py-2 rounded-lg disabled:opacity-40" style={{ ...text, background: 'rgba(255,255,255,.08)' }}>{t('Choose folder')}</button></div></>}
    {tab === 'galleries' && <div><div className="mb-2" style={text}>{t('If a folder with the same name exists')}</div><select value={folderConflict} onChange={e => setFolderConflict(e.target.value)} className="w-full px-3 py-2 rounded-lg" style={{ ...text, background: 'var(--c-card)' }}><option value="rename">{t('Keep both — rename incoming')}</option><option value="merge">{t('Merge folders safely')}</option><option value="cancel">{t('Stop that gallery import')}</option></select></div>}
  </div><div className="p-4 space-y-2" style={{ borderTop: '1px solid rgba(255,255,255,.08)' }}>
    <button onClick={onCommit} disabled={!selectedCount || busy || choosingBase || (mode === 'unsorted' && !intakeConfig?.unsorted_folder) || (mode === 'new_creator' && !intakeConfig?.new_creator_base)} className="w-full py-3 rounded-lg flex justify-center items-center gap-2 disabled:opacity-40" style={{ ...text, background: 'var(--accent)' }}>{busy ? <Loader2 className="animate-spin" /> : <ArrowRight />}{mode === 'unsorted' ? t('Import as unsorted') : tab === 'galleries' ? t('Import galleries') : t('Sort files')} {selectedCount ? `(${selectedCount})` : ''}</button>
    {!!selectedCount && <><button onClick={() => onAction('hide')} className="w-full py-2 rounded-lg" style={{ ...text, background: 'rgba(255,255,255,.05)' }}>{t('Hide until next scan')}</button><button onClick={() => onAction('ignore')} className="w-full py-2 rounded-lg flex justify-center gap-2" style={{ ...text, background: 'rgba(255,255,255,.05)' }}><ShieldCheck size={20} />{t('Ignore permanently')}</button><button onClick={() => onAction('delete')} className="w-full py-2 rounded-lg flex justify-center gap-2" style={{ ...text, color: 'var(--c-pink)', background: 'color-mix(in srgb,var(--c-pink) 12%,transparent)' }}><Trash2 size={20} />{t('Delete permanently')}</button></>}
  </div>{choosingBase && <FolderPicker initialPath={intakeConfig?.new_creator_base || ''} onSelect={saveCreatorBase} onClose={() => setChoosingBase(false)} />}</aside>
}

function FolderPreview({ folder, onClose, t }) {
  const [active, setActive] = useState(null)
  const query = useInfiniteQuery({
    queryKey: ['intake-folder-contents', folder.id],
    queryFn: ({ pageParam = 1 }) => intakeApi.folderContents(folder.id, { page: pageParam, limit: 120 }).then(response => response.data),
    initialPageParam: 1,
    getNextPageParam: page => page.has_more ? page.page + 1 : undefined,
  })
  const items = query.data?.pages.flatMap(page => page.items) || []
  const summary = query.data?.pages[0]
  const sentinel = useSentinel(query.hasNextPage && !query.isFetchingNextPage, () => query.fetchNextPage())

  if (active) {
    const back = () => setActive(null)
    if (active.is_archive) return <ArchivePreview item={active} onClose={back} closeLabel={t('Back to gallery folder')} t={t} />
    if (active.duplicate) return <DuplicateDetails item={active} onClose={back} closeLabel={t('Back to gallery folder')} t={t} />
    return <MediaPreview item={active} onClose={back} closeLabel={t('Back to gallery folder')} t={t} />
  }

  return <Modal title={folder.name} onClose={onClose} closeLabel={t('Back to Loading Bay')} width="min(1280px, 96vw)">
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap" style={text}><span className="px-3 py-1 rounded-full" style={{ background: 'rgba(255,255,255,.07)' }}>{summary?.file_count ?? folder.file_count} {t('files')}</span><span className="px-3 py-1 rounded-full" style={{ background: 'rgba(255,255,255,.07)' }}>{summary?.video_count ?? folder.video_count} {t('videos')}</span><span className="px-3 py-1 rounded-full" style={{ background: 'rgba(255,255,255,.07)' }}>{fmtSize(summary?.total_size ?? folder.total_size)}</span></div>
      {(summary?.preview_reason || folder.preview_reason) && <div className="flex items-start gap-3 p-4 rounded-xl" style={{ ...text, color: 'var(--c-amber)', background: 'color-mix(in srgb,var(--c-amber) 11%,transparent)', border: '1px solid color-mix(in srgb,var(--c-amber) 28%,transparent)' }}><AlertTriangle size={22} className="flex-shrink-0 mt-0.5" /><div><div className="font-semibold">{t('Why this folder has no cover')}</div><div>{summary?.preview_reason || folder.preview_reason}</div></div></div>}
      {query.isLoading ? <div className="h-64 flex items-center justify-center"><Loader2 className="animate-spin" /></div> : query.error ? <div style={{ ...text, color: 'var(--c-pink)' }}>{query.error?.response?.data?.detail || t('Could not open this folder.')}</div> : <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(190px,1fr))' }}>{items.map(item => <button key={item.id} onClick={() => setActive(item)} className="loading-bay-card text-left rounded-xl overflow-hidden" style={{ background: 'var(--c-bg)', border: '1px solid rgba(255,255,255,.1)' }}><div className="relative aspect-square flex items-center justify-center overflow-hidden">{item.thumb ? <img src={item.thumb} alt="" className="w-full h-full object-cover" /> : item.is_video ? <Film size={44} /> : <FileArchive size={44} />}<span className="absolute top-2 right-2 p-2 rounded-lg" style={{ background: 'rgba(0,0,0,.75)' }}><Eye size={18} /></span>{item.is_video && <span className="absolute bottom-2 left-2 px-2 py-1 rounded-lg" style={{ ...text, background: 'rgba(0,0,0,.75)' }}>{t('VIDEO')}</span>}</div><div className="p-3"><div className="truncate font-semibold" title={item.filename} style={text}>{item.filename}</div><div style={{ ...text, opacity: .58 }}>{mediaFacts(item).join(' · ') || fmtSize(item.file_size)}</div>{!item.thumb && <div className="mt-1" style={{ ...text, color: 'var(--c-amber)' }}>{t('No thumbnail — click to open')}</div>}</div></button>)}</div>}
      <div ref={sentinel} className="h-12 flex items-center justify-center">{query.isFetchingNextPage && <Loader2 className="animate-spin" />}</div>
    </div>
  </Modal>
}

function MediaPreview({ item, onClose, closeLabel, t }) {
  return <Modal title={item.filename} onClose={onClose} closeLabel={closeLabel || t('Back to Loading Bay')} width="min(1120px, 94vw)">
    <div className="relative w-full h-[min(720px,72vh)] overflow-hidden rounded-xl flex items-center justify-center" style={{ background: '#050505', border: '1px solid rgba(255,255,255,.1)' }}>
      {item.is_video
        ? <InlineVideoPlayer src={intakeApi.fileUrl(item.id)} deviceSync={false} showControls />
        : <img src={intakeApi.fileUrl(item.id)} alt={item.filename} className="max-w-full max-h-full object-contain" />}
    </div>
    <div className="flex items-center justify-between gap-4 flex-wrap pt-4" style={text}>
      <div className="flex gap-2 flex-wrap">{mediaFacts(item).map(fact => <span key={fact} className="px-3 py-1 rounded-full font-semibold" style={{ background: 'rgba(255,255,255,.07)' }}>{fact}</span>)}</div>
      <span style={{ opacity: .6 }}>{t('Preview only — no views or device activity are recorded.')}</span>
    </div>
  </Modal>
}

function DuplicateDetails({ item, onClose, closeLabel, t }) {
  const d = item.duplicate
  const [playing, setPlaying] = useState(null)
  return <Modal title={t('Duplicate comparison')} onClose={onClose} closeLabel={closeLabel || t('Back to Loading Bay')} width="min(1240px, 96vw)">
    <div className="space-y-4">
      <div className="flex items-start gap-3 p-4 rounded-xl" style={{ ...text, background: d.safe_to_auto_delete ? 'color-mix(in srgb,var(--c-green) 12%,transparent)' : 'color-mix(in srgb,var(--c-amber) 12%,transparent)', border: `1px solid color-mix(in srgb,${d.safe_to_auto_delete ? 'var(--c-green)' : 'var(--c-amber)'} 35%,transparent)` }}>
        <AlertTriangle size={22} className="flex-shrink-0 mt-0.5" />
        <div><div className="font-semibold mb-1">{t('Why these files were matched')}</div><div>{d.reason}</div></div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <CompareCard eyebrow={t('INCOMING FILE')} title={t('Waiting in Loading Bay')} image={item.thumb} name={item.filename} facts={mediaFacts(item)} isVideo={item.is_video} playing={playing === 'incoming'} videoSrc={intakeApi.fileUrl(item.id)} onPlay={() => setPlaying(playing === 'incoming' ? null : 'incoming')} accent="var(--accent)" t={t} />
        <CompareCard eyebrow={t('VAULT ORIGINAL')} title={t('Already in the Vault')} image={d.thumb} name={d.filename} detail={[d.creator_name, d.gallery_name].filter(Boolean).join(' · ')} facts={mediaFacts(d)} isVideo={d.is_video} playing={playing === 'vault'} videoSrc={d.file_url} onPlay={() => setPlaying(playing === 'vault' ? null : 'vault')} accent="var(--c-green)" t={t} />
      </div>
      <div className="p-3 rounded-lg" style={{ ...text, color: d.safe_to_auto_delete ? 'var(--c-green)' : 'var(--c-amber)', background: 'rgba(255,255,255,.035)' }}>
        {d.safe_to_auto_delete ? t('These files are byte-for-byte identical. The incoming copy can be safely deleted or ignored.') : t('This is a visual similarity match, not proof that the files are byte-for-byte identical. Compare both sides before acting.')}
      </div>
    </div>
  </Modal>
}

function CompareCard({ eyebrow, title, image, name, detail, facts = [], isVideo, playing, videoSrc, onPlay, accent, t }) {
  return <section className="loading-bay-card rounded-xl overflow-hidden" style={{ background: 'var(--c-bg)', border: `1px solid color-mix(in srgb,${accent} 32%,rgba(255,255,255,.08))` }}>
    <div className="px-4 py-3 flex items-center justify-between gap-3" style={{ borderBottom: '1px solid rgba(255,255,255,.08)' }}>
      <div><div className="font-bold tracking-wide" style={{ ...text, color: accent }}>{eyebrow}</div><div className="font-semibold" style={text}>{title}</div></div>
      {isVideo && <button onClick={onPlay} className="px-3 py-2 rounded-lg font-semibold" style={{ ...text, background: 'rgba(255,255,255,.09)' }}>{playing ? t('Show poster') : t('Play video')}</button>}
    </div>
    <div className="relative h-[min(500px,50vh)] flex items-center justify-center overflow-hidden" style={{ background: '#050505' }}>
      {playing && videoSrc ? <InlineVideoPlayer src={videoSrc} deviceSync={false} showControls /> : image ? <img src={image} alt={name} className="w-full h-full object-contain" /> : <div style={{ ...text, opacity: .55 }}>{t('No preview available')}</div>}
    </div>
    <div className="p-4 space-y-2">
      <div className="font-semibold break-all" style={text}>{name}</div>
      <div className="flex gap-2 flex-wrap">{facts.map(fact => <span key={fact} className="px-2 py-1 rounded-lg font-semibold" style={{ ...text, color: accent, background: `color-mix(in srgb,${accent} 11%,transparent)` }}>{fact}</span>)}</div>
      {detail && <div className="flex items-center gap-2" style={{ ...text, opacity: .72 }}><FolderOpen size={18} className="flex-shrink-0" /><span>{detail}</span></div>}
    </div>
  </section>
}

function ArchivePreview({ item, onClose, closeLabel, t }) {
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['intake-archive', item.id], queryFn: () => intakeApi.archiveContents(item.id).then(r => r.data) })
  return <Modal title={item.filename} onClose={onClose} closeLabel={closeLabel}><div className="w-[min(900px,80vw)] max-h-[70vh] overflow-y-auto">{isLoading ? <ArchiveProgress format={item.filename.split('.').pop()} t={t} /> : error ? <div className="space-y-3" style={text}><div style={{ color: 'var(--c-pink)' }}>{error?.response?.data?.detail || t('Could not inspect this archive.')}</div><button onClick={() => refetch()} className="px-3 py-2 rounded-lg" style={{ background: 'var(--accent)' }}>{t('Try again')}</button></div> : <><div style={text}>{data?.counts?.images || 0} {t('images')} · {data?.counts?.videos || 0} {t('videos')} · {data?.counts?.other || 0} {t('other')}</div>{data?.format === 'rar' && data?.preview_names?.length > 0 ? <div className="p-3 my-3 rounded-lg" style={{ ...text, background: 'rgba(255,255,255,.05)' }}>{t('RAR contents loaded. Automatic thumbnails are skipped because extracting every preview separately is very slow.')}</div> : <div className="grid grid-cols-5 gap-2 my-3">{data?.preview_names?.map(name => <img key={name} src={intakeApi.archivePreviewUrl(item.id, name)} alt={name} className="aspect-square object-cover rounded-lg" />)}</div>}{data?.entries?.filter(e => e.kind !== 'dir').map(e => <div key={e.name} className="flex justify-between gap-4 py-2" style={{ ...text, borderBottom: '1px solid rgba(255,255,255,.06)' }}><span className="truncate">{e.name}</span><span className="flex-shrink-0">{fmtSize(e.size)}</span></div>)}</>}</div></Modal>
}

function ArchiveProgress({ format, t }) {
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => { const timer = setInterval(() => setElapsed(value => value + 1), 1000); return () => clearInterval(timer) }, [])
  const width = Math.min(92, 12 + elapsed * 4)
  return <div className="py-12 space-y-4" style={text}><div className="flex items-center gap-3"><Loader2 className="animate-spin" /><span>{t('Inspecting')} {String(format || '').toUpperCase()} {t('archive…')} {elapsed > 0 && `· ${elapsed}s`}</span></div><div className="h-3 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,.08)' }}><div className="h-full transition-all duration-1000" style={{ width: `${width}%`, background: 'var(--accent)' }} /></div><div style={{ opacity: .55 }}>{t('Large or solid archives can take a while. The Loading Bay is still working.')}</div></div>
}

function Modal({ title, onClose, closeLabel, children, width = 'fit-content' }) {
  useEffect(() => {
    const closeOnEscape = event => event.key === 'Escape' && onClose()
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onClose])
  return <div className="loading-bay-modal-backdrop fixed inset-0 z-[70] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,.82)' }} onMouseDown={e => e.target === e.currentTarget && onClose()}>
    <div className="loading-bay-modal-shell rounded-2xl max-h-[94vh] overflow-hidden flex flex-col shadow-2xl" style={{ width, maxWidth: '96vw', background: 'var(--c-card)', border: '1px solid rgba(255,255,255,.12)' }}>
      <header className="flex gap-4 items-center px-5 py-4 flex-shrink-0" style={{ background: 'var(--c-card)', borderBottom: '1px solid rgba(255,255,255,.09)' }}>
        <div className="flex-1 font-semibold truncate" style={{ fontSize: 18 }}>{title}</div>
        <button onClick={onClose} className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ ...text, background: 'rgba(255,255,255,.09)' }}>{closeLabel && <span>{closeLabel}</span>}<X size={22} /></button>
      </header>
      <div className="p-5 overflow-y-auto">{children}</div>
    </div>
  </div>
}

function Empty({ roots, t }) { return <div className="h-full flex flex-col items-center justify-center gap-3" style={text}><Inbox size={48} /><div>{roots.length ? t('Nothing matches this view. Scan again to refresh the Loading Bay.') : t('Add a Loading Bay folder in Settings, then scan it.')}</div></div> }

function LoadingBaySettings({ roots, refreshRoots, t }) {
  const qc = useQueryClient()
  const { data: config } = useQuery({ queryKey: ['intake-config'], queryFn: () => intakeApi.getConfig().then(r => r.data) })
  const [base, setBase] = useState('')
  const [unsorted, setUnsorted] = useState('')
  const [pickerTarget, setPickerTarget] = useState(null)
  useEffect(() => { if (config) { setBase(config.new_creator_base || ''); setUnsorted(config.unsorted_folder || '') } }, [config])
  const chooseFolder = async path => {
    if (pickerTarget === 'root') { await intakeApi.addRoot(path); refreshRoots() }
    else if (pickerTarget === 'unsorted') setUnsorted(path)
    else if (pickerTarget === 'base') setBase(path)
  }
  const save = async patch => { await intakeApi.setConfig(patch); qc.invalidateQueries({ queryKey: ['intake-config'] }); toast.success(t('Settings saved')) }
  return <div className="p-6 overflow-y-auto space-y-7" style={text}>
    <section><h2 style={{ fontSize: 20, fontWeight: 700 }}>{t('Loading Bay folders')}</h2>{roots.map(root => <div key={root.id} className="flex items-center gap-3 py-2"><FolderOpen /><span className="flex-1">{root.label || root.path}</span><button onClick={async () => { await intakeApi.delRoot(root.id); refreshRoots() }}><Trash2 /></button></div>)}<button onClick={() => setPickerTarget('root')} className="px-3 py-2 rounded-lg flex gap-2" style={{ ...text, background: 'rgba(255,255,255,.06)' }}><FolderPlus />{t('Add folder')}</button></section>
    <section className="p-4 rounded-xl" style={{ background: 'color-mix(in srgb,var(--accent) 8%,transparent)', border: '1px solid color-mix(in srgb,var(--accent) 28%,transparent)' }}><h2 style={{ fontSize: 20, fontWeight: 700 }}>{t('Unsorted import folder')}</h2><p className="my-2" style={{ opacity: .68 }}>{t('Raw imports move here without assigning a creator. Loose files become one Unsorted gallery; complete folders remain separate galleries beneath it.')}</p><div className="flex gap-2"><input value={unsorted} onChange={e => setUnsorted(e.target.value)} placeholder={t('Choose a folder outside the Loading Bay…')} className="flex-1 px-3 py-2 rounded-lg" style={{ ...text, background: 'rgba(255,255,255,.05)' }} /><button onClick={() => setPickerTarget('unsorted')} className="px-4 rounded-lg" style={{ ...text, background: 'rgba(255,255,255,.08)' }}>{t('Browse')}</button><button onClick={() => save({ unsorted_folder: unsorted })} className="px-4 rounded-lg" style={{ ...text, background: 'var(--accent)' }}>{t('Save')}</button></div></section>
    <section><h2 style={{ fontSize: 20, fontWeight: 700 }}>{t('New creator base folder')}</h2><div className="flex gap-2"><input value={base} onChange={e => setBase(e.target.value)} className="flex-1 px-3 py-2 rounded-lg" style={{ ...text, background: 'rgba(255,255,255,.05)' }} /><button onClick={() => setPickerTarget('base')} className="px-4 rounded-lg" style={{ ...text, background: 'rgba(255,255,255,.08)' }}>{t('Browse')}</button><button onClick={() => save({ new_creator_base: base })} className="px-4 rounded-lg" style={{ ...text, background: 'var(--accent)' }}>{t('Save')}</button></div></section>
    <section><h2 style={{ fontSize: 20, fontWeight: 700 }}>{t('Archives')}</h2><label className="flex gap-3"><input type="checkbox" checked={config?.extract_archives ?? true} onChange={e => save({ extract_archives: e.target.checked })} />{t('Extract loose archives when sorted')}</label><select value={config?.archive_after || 'delete'} onChange={e => save({ archive_after: e.target.value })} className="mt-3 px-3 py-2 rounded-lg" style={{ ...text, background: 'var(--c-card)' }}><option value="delete">{t('Delete original after extraction')}</option><option value="move">{t('Move original into destination')}</option><option value="keep">{t('Leave original in Loading Bay')}</option></select></section>
    {pickerTarget && <FolderPicker onSelect={chooseFolder} onClose={() => setPickerTarget(null)} />}
  </div>
}

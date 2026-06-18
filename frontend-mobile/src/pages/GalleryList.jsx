import { useState, useEffect, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Search, Eye, ArrowUpDown, FolderOpen, SlidersHorizontal, X, UserPlus, Pencil, Trash2, CheckSquare, ListPlus } from 'lucide-react'
import { galleriesApi, creatorsApi, tagsApi } from '../lib/api.js'
import { coverUrl } from '../lib/media.js'
import { useVaultStore } from '../store/vault.js'
import { PageHeader, Spinner, Empty, CountPill } from '../components/ui.jsx'
import LongPress from '../components/LongPress.jsx'
import BottomSheet from '../components/BottomSheet.jsx'
import PickerSheet from '../components/PickerSheet.jsx'

const SORTS = [
  { id: 'date_added',  label: 'Recently added' },
  { id: 'name',        label: 'Name' },
  { id: 'rating',      label: 'Rating' },
  { id: 'cum_count',   label: 'Cum count' },
  { id: 'image_count', label: 'Image count' },
  { id: 'random',      label: 'Random' },
]

export default function GalleryList() {
  const nav = useNavigate()
  const qc = useQueryClient()
  const addToast = useVaultStore(s => s.addToast)
  const openPlaylistPicker = useVaultStore(s => s.openPlaylistPicker)
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState('date_added')
  const [sortDir, setSortDir] = useState('desc')   // toggled by re-tapping a sort
  const [sortOpen, setSortOpen] = useState(false)
  const [sheet, setSheet] = useState(null)        // gallery action sheet

  // filters
  const [filterOpen, setFilterOpen] = useState(false)
  const [picker, setPicker] = useState(null)      // 'creator' | 'franchise' | 'tags'
  const [creatorId, setCreatorId] = useState(null)
  const [series, setSeries] = useState(null)
  const [tagIds, setTagIds] = useState([])

  // multi-select
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState([])
  const [assignFor, setAssignFor] = useState(null) // gallery (single) being assigned, or 'bulk'
  const [renaming, setRenaming] = useState(null)
  const [renameVal, setRenameVal] = useState('')

  const tagsCsv = tagIds.length ? tagIds.join(',') : undefined
  const { data, isLoading } = useQuery({
    queryKey: ['galleries', search, sortBy, sortDir, creatorId, series, tagsCsv],
    queryFn: () => galleriesApi.list({
      search: search || undefined, sort_by: sortBy, limit: 300,
      sort_dir: sortBy === 'random' ? undefined : sortDir,
      creator_id: creatorId || undefined, series: series || undefined, tags: tagsCsv,
    }).then(r => r.data),
  })

  // Tapping a sort: a new sort picks its natural default direction; re-tapping the
  // current sort flips the direction (e.g. rating high→low becomes low→high).
  function pickSort(id) {
    if (id === sortBy) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortBy(id); setSortDir(id === 'name' ? 'asc' : 'desc') }
  }

  // Progressive rendering: only mount a window of cards and grow it as the user
  // scrolls. Keeps the DOM small (and the GPU/CPU cool) even for big libraries.
  const BATCH = 30
  const [visible, setVisible] = useState(BATCH)
  const sentinel = useRef(null)
  useEffect(() => { setVisible(BATCH) }, [search, sortBy, sortDir, creatorId, series, tagsCsv])
  useEffect(() => {
    if (!sentinel.current) return
    const io = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) setVisible(v => v + BATCH) },
      { rootMargin: '600px' }   // prefetch a screen ahead so scrolling stays smooth
    )
    io.observe(sentinel.current)
    return () => io.disconnect()
  }, [data])
  const shown = data?.slice(0, visible) || []

  const { data: creators } = useQuery({ queryKey: ['creators-all'], queryFn: () => creatorsApi.list({ limit: 1000 }).then(r => r.data), enabled: filterOpen || !!assignFor })
  const { data: franchises } = useQuery({ queryKey: ['franchises'], queryFn: () => creatorsApi.franchises().then(r => r.data), enabled: filterOpen })
  const { data: tags } = useQuery({ queryKey: ['tags-all'], queryFn: () => tagsApi.list().then(r => r.data), enabled: filterOpen })

  const filterCount = (creatorId ? 1 : 0) + (series ? 1 : 0) + tagIds.length
  const creatorName = creators?.find(c => c.id === creatorId)?.name

  async function addGalleryToPlaylist(g) {
    try {
      const { data } = await galleriesApi.images(g.id, { limit: 1000 })
      const ids = (data || []).map(im => im.id)
      if (!ids.length) { addToast('Gallery is empty', 'info'); return }
      openPlaylistPicker(ids)
    } catch { addToast('Failed', 'info') }
  }
  async function assignCreator(cid) {
    const ids = assignFor === 'bulk' ? selected : [assignFor.id]
    try {
      if (ids.length > 1) await galleriesApi.bulkAssign(ids, cid)
      else await galleriesApi.addCreator(ids[0], cid)
      addToast('Creator assigned', 'xp'); qc.invalidateQueries({ queryKey: ['galleries'] })
      exitSelect()
    } catch { addToast('Failed', 'info') }
    setAssignFor(null)
  }
  async function doRename() {
    const name = renameVal.trim()
    if (!name || !renaming) return
    try { await galleriesApi.renameFolder(renaming.id, name); addToast('Renamed', 'xp'); qc.invalidateQueries({ queryKey: ['galleries'] }) }
    catch (e) { addToast(e?.response?.data?.detail || 'Rename failed', 'info') }
    setRenaming(null); setRenameVal('')
  }
  async function del(g) {
    if (!confirm(`Delete "${g.name}"? This removes it from the Vault (files stay on disk).`)) return
    try { await galleriesApi.delete(g.id, false); addToast('Gallery deleted', 'info'); qc.invalidateQueries({ queryKey: ['galleries'] }) }
    catch { addToast('Failed', 'info') }
  }

  function toggleSel(id) {
    setSelected(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id])
  }
  function exitSelect() { setSelectMode(false); setSelected([]) }

  return (
    <div>
      <PageHeader title={selectMode ? `${selected.length} selected` : 'Galleries'} right={
        selectMode ? (
          <button onClick={exitSelect} className="p-2 -mr-2"><X size={22} /></button>
        ) : (
          <div className="flex">
            <button onClick={() => setFilterOpen(true)} className="relative p-2">
              <SlidersHorizontal size={22} />
              {filterCount > 0 && <span className="absolute top-0 right-0 w-2.5 h-2.5 rounded-full" style={{ background: 'var(--accent)' }} />}
            </button>
            <button onClick={() => setSortOpen(true)} className="p-2 -mr-2"><ArrowUpDown size={22} /></button>
          </div>
        )
      } />

      {!selectMode && (
        <div className="px-4 pb-3">
          <div className="flex items-center gap-2 px-3 rounded-xl" style={{ background: 'var(--c-card)' }}>
            <Search size={18} style={{ color: 'rgba(255,255,255,0.4)' }} />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search galleries"
                   className="flex-1 py-2.5 bg-transparent outline-none text-[16px]" />
          </div>
          {filterCount > 0 && (
            <div className="flex gap-2 flex-wrap mt-2">
              {creatorId && <Chip label={creatorName || 'Creator'} onClear={() => setCreatorId(null)} />}
              {series && <Chip label={series} onClear={() => setSeries(null)} />}
              {tagIds.map(tid => <Chip key={tid} label={tags?.find(t => t.id === tid)?.name || 'tag'} onClear={() => setTagIds(s => s.filter(x => x !== tid))} />)}
            </div>
          )}
        </div>
      )}

      {/* Bulk action bar */}
      {selectMode && selected.length > 0 && (
        <div className="flex gap-2 px-4 pb-3">
          <button onClick={() => setAssignFor('bulk')} className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-[15px] font-semibold"
                  style={{ background: 'var(--accent)', color: '#fff' }}><UserPlus size={18} /> Assign creator</button>
        </div>
      )}

      {isLoading ? <Spinner /> : !data?.length ? (
        <Empty icon={<FolderOpen size={40} />} text="No galleries found" />
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5 px-4">
          {shown.map(g => {
            const cover = coverUrl(g)
            const sel = selected.includes(g.id)
            return (
              <LongPress key={g.id}
                onClick={() => selectMode ? toggleSel(g.id) : nav(`/gallery/${g.id}`)}
                onLongPress={() => { if (!selectMode) setSheet(g) }}
                className="text-left"
                style={{ contentVisibility: 'auto', containIntrinsicSize: '240px' }}>
                <div className="relative aspect-[3/4] rounded-vault overflow-hidden" style={{ background: 'var(--c-card)', outline: sel ? '3px solid var(--accent)' : 'none' }}>
                  {cover && <img src={cover} alt={g.name} loading="lazy" decoding="async" className="w-full h-full object-cover" />}
                  <div className="absolute top-1.5 right-1.5 flex gap-1"><CountPill value={g.cum_count} /></div>
                  <div className="absolute bottom-1.5 left-1.5 text-[12px] px-1.5 py-0.5 rounded bg-black/55">{g.image_count}</div>
                  {selectMode && (
                    <div className="absolute top-1.5 left-1.5 w-6 h-6 rounded-full flex items-center justify-center"
                         style={{ background: sel ? 'var(--accent)' : 'rgba(0,0,0,0.5)', border: '2px solid #fff' }}>
                      {sel && <CheckSquare size={14} color="#fff" />}
                    </div>
                  )}
                </div>
                <div className="mt-1 text-[14px] truncate">{g.name}</div>
              </LongPress>
            )
          })}
          {/* Infinite-scroll trigger — mounts the next batch as it nears the viewport */}
          {visible < (data?.length || 0) && <div ref={sentinel} className="col-span-full h-1" />}
        </div>
      )}
      <div className="h-4" />

      {/* Sort sheet — re-tap the active sort to flip the direction */}
      <BottomSheet open={sortOpen} onClose={() => setSortOpen(false)} title="Sort by"
        actions={SORTS.map(s => ({
          label: s.label + (sortBy === s.id ? (s.id === 'random' ? '  ✓' : (sortDir === 'asc' ? '  ↑' : '  ↓')) : ''),
          onClick: () => pickSort(s.id),
        }))} />

      {/* Filter sheet */}
      <BottomSheet open={filterOpen} onClose={() => setFilterOpen(false)} title="Filter galleries"
        actions={[
          { label: creatorId ? `Creator: ${creatorName}` : 'Filter by creator', onClick: () => setPicker('creator') },
          { label: series ? `Franchise: ${series}` : 'Filter by franchise', onClick: () => setPicker('franchise') },
          { label: tagIds.length ? `Tags (${tagIds.length})` : 'Filter by tags', onClick: () => setPicker('tags') },
          ...(filterCount > 0 ? [{ label: 'Clear all filters', danger: true, onClick: () => { setCreatorId(null); setSeries(null); setTagIds([]) } }] : []),
        ]} />

      {/* Gallery action sheet */}
      <BottomSheet open={!!sheet} onClose={() => setSheet(null)} title={sheet?.name}
        actions={sheet ? [
          { label: 'Open gallery', icon: <FolderOpen size={20} />, onClick: () => nav(`/gallery/${sheet.id}`) },
          { label: 'View images',  icon: <Eye size={20} />,        onClick: () => nav(`/view/${sheet.id}`) },
          { label: 'Add to playlist', icon: <ListPlus size={20} />, onClick: () => addGalleryToPlaylist(sheet) },
          { label: 'Assign creator', icon: <UserPlus size={20} />, onClick: () => setAssignFor(sheet) },
          { label: 'Rename',       icon: <Pencil size={20} />,     onClick: () => { setRenaming(sheet); setRenameVal(sheet.name) } },
          { label: 'Select multiple', icon: <CheckSquare size={20} />, onClick: () => { setSelectMode(true); setSelected([sheet.id]) } },
          { label: 'Delete',       icon: <Trash2 size={20} />, danger: true, onClick: () => del(sheet) },
        ] : []} />

      {/* Pickers */}
      <PickerSheet open={picker === 'creator'} onClose={() => setPicker(null)} title="Creator" selected={creatorId}
        options={(creators || []).map(c => ({ id: c.id, label: c.name }))} onSelect={setCreatorId} />
      <PickerSheet open={picker === 'franchise'} onClose={() => setPicker(null)} title="Franchise" selected={series}
        options={(franchises || []).map(f => ({ id: f, label: f }))} onSelect={setSeries} />
      <PickerSheet open={picker === 'tags'} onClose={() => setPicker(null)} title="Tags" multi selected={tagIds}
        options={(tags || []).map(t => ({ id: t.id, label: t.name }))} onToggle={tid => setTagIds(s => s.includes(tid) ? s.filter(x => x !== tid) : [...s, tid])} />

      {/* Assign creator picker */}
      <PickerSheet open={!!assignFor} onClose={() => setAssignFor(null)} title="Assign creator"
        options={(creators || []).map(c => ({ id: c.id, label: c.name }))} onSelect={assignCreator} />

      {/* Rename sheet */}
      <BottomSheet open={!!renaming} onClose={() => { setRenaming(null); setRenameVal('') }} title="Rename gallery">
        <div className="px-5 pb-4">
          <input autoFocus value={renameVal} onChange={e => setRenameVal(e.target.value)} maxLength={120}
                 className="w-full px-3 py-3 rounded-xl bg-transparent outline-none text-[16px] mb-3"
                 style={{ border: '1px solid rgba(255,255,255,0.15)' }} />
          <button onClick={doRename} className="w-full py-3 rounded-xl text-[16px] font-semibold" style={{ background: 'var(--accent)', color: '#fff' }}>Rename folder</button>
          <p className="text-[13px] mt-2" style={{ color: 'rgba(255,255,255,0.4)' }}>This renames the folder on your PC.</p>
        </div>
      </BottomSheet>
    </div>
  )
}

function Chip({ label, onClear }) {
  return (
    <span className="flex items-center gap-1 pl-3 pr-2 py-1 rounded-full text-[14px]" style={{ background: 'var(--c-card)' }}>
      {label}
      <button onClick={onClear} className="p-0.5"><X size={14} style={{ color: 'rgba(255,255,255,0.5)' }} /></button>
    </span>
  )
}

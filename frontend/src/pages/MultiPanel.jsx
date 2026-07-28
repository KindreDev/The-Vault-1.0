import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Plus, Trash2, X, Heart, Search, Video, Images,
  Maximize, Minimize, ChevronDown, LayoutGrid, MoreVertical, Sliders,
  ListMusic, Save, Play, Pencil, Shuffle,
} from 'lucide-react'
import { useVaultStore } from '../store/vault'
import { useDeviceStore } from '../store/deviceStore'
import { galleriesApi, imagesApi, sessionsApi, panelPlaylistsApi } from '../lib/api'
import PanelCell from '../components/PanelCell'
import DeviceControls from '../components/DeviceControls'
import toast from 'react-hot-toast'

// ── Layout definitions ────────────────────────────────────────────────────────
const LAYOUTS = [
  { count: 1, label: '1', rows: [[0]] },
  { count: 2, label: '2', rows: [[0, 1]] },
  { count: 3, label: '3', rows: [[0, 1, 2]] },
  { count: 4, label: '4', rows: [[0, 1], [2, 3]] },
  { count: 6, label: '6', rows: [[0, 1, 2], [3, 4, 5]] },
]

function distributeItems(queue, panelCount, mode, manualAssignments, perPanelShuffle = {}) {
  const panels = Array.from({ length: panelCount }, () => [])

  // 1. Manually assigned items
  const unassigned = []
  const panelsWithManual = new Set()

  queue.forEach(qItem => {
    const assignedIdx = manualAssignments[qItem.id]
    if (assignedIdx !== undefined && assignedIdx < panelCount) {
      if (qItem.type === 'gallery') panels[assignedIdx].push(...(qItem.images || []))
      else panels[assignedIdx].push(qItem.media)
      panelsWithManual.add(assignedIdx)
    } else {
      unassigned.push(qItem)
    }
  })

  // Per-panel mode: each panel runs only what's pinned to it. Unassigned items
  // deliberately don't leak into empty panels — an empty panel means "nothing
  // loaded here yet", which is what makes the panels independent playlists.
  if (mode === 'per-panel') {
    return panels.map((items, i) =>
      perPanelShuffle[i] ? [...items].sort(() => Math.random() - 0.5) : items
    )
  }

  // 2. Auto-distribute the rest to available panels
  const availablePanels = []
  for (let i = 0; i < panelCount; i++) {
    if (!panelsWithManual.has(i)) availablePanels.push(i)
  }
  // If all panels have manual assignments, fallback to distributing to all
  const targetPanels = availablePanels.length > 0 ? availablePanels : Array.from({ length: panelCount }, (_, i) => i)

  if (mode === 'grouped') {
    unassigned.forEach((qItem, i) => {
      const targetPanelIdx = targetPanels[i % targetPanels.length]
      if (qItem.type === 'gallery') {
        panels[targetPanelIdx].push(...(qItem.images || []))
      } else {
        panels[targetPanelIdx].push(qItem.media)
      }
    })
  } else {
    // flat / shuffled
    const flat = []
    unassigned.forEach(qItem => {
      if (qItem.type === 'gallery') flat.push(...(qItem.images || []))
      else flat.push(qItem.media)
    })
    const shuffled = [...flat].sort(() => Math.random() - 0.5)
    shuffled.forEach((img, i) => {
      const targetPanelIdx = targetPanels[i % targetPanels.length]
      panels[targetPanelIdx].push(img)
    })
  }
  
  return panels
}

// ── Per-panel playlist bar ────────────────────────────────────────────────────
//
// Shown only in per-panel mode. An empty panel gets a clear call to action; a
// loaded panel keeps a faint label that lifts to full strength on hover, so it
// identifies itself without competing with what's playing.
// A loaded panel gets a real header ROW above the media rather than a floating
// overlay. Overlaying sat on top of PanelCell's own top bar — covering the zoom
// slider, and stealing hover so those controls hid the moment you reached for
// them. A row can't collide with anything inside the player.
function PanelPlaylistBar({ panelIdx, label, count, shuffled, onLoad, onClear, onToggleShuffle }) {
  if (count === 0) {
    // Empty panel: PanelCell only shows a static placeholder here, so a centred
    // overlay is safe. pointer-events stay off except on the button itself.
    return (
      <div className="absolute inset-0 z-40 flex flex-col items-center justify-center gap-2 pointer-events-none">
        <div className="text-[13px] text-[rgba(255,255,255,0.3)]">Panel {panelIdx + 1}</div>
        <button onMouseDown={onLoad}
                className="pointer-events-auto flex items-center gap-2 px-3 py-1.5 rounded-full text-[13px] cursor-pointer"
                style={{ background: 'rgba(127,119,221,0.2)', color: '#CECBF6', border: '0.5px solid rgba(127,119,221,0.4)' }}>
          <ListMusic size={13} /> Load playlist
        </button>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-1.5 px-2 flex-shrink-0"
         style={{ height: 26, background: '#101010', borderBottom: '0.5px solid rgba(255,255,255,0.07)' }}>
      <ListMusic size={11} style={{ color: 'rgba(127,119,221,0.8)', flexShrink: 0 }} />
      <span className="text-[13px] font-medium truncate" style={{ color: '#CECBF6' }}>
        {label || `Panel ${panelIdx + 1}`}
      </span>
      <span className="text-[12px] flex-shrink-0 tabular-nums" style={{ color: 'rgba(255,255,255,0.35)' }}>{count}</span>
      <div className="flex items-center gap-0.5 ml-auto flex-shrink-0">
        <button onMouseDown={onToggleShuffle} title={shuffled ? 'Playing shuffled' : 'Playing in order'}
                className="p-1 rounded-[5px] cursor-pointer hover:bg-[rgba(255,255,255,0.1)]"
                style={{ color: shuffled ? '#CECBF6' : 'rgba(255,255,255,0.35)' }}>
          <Shuffle size={12} />
        </button>
        <button onMouseDown={onLoad} title="Load a different playlist"
                className="p-1 rounded-[5px] cursor-pointer hover:bg-[rgba(255,255,255,0.1)]"
                style={{ color: 'rgba(255,255,255,0.4)' }}>
          <ListMusic size={12} />
        </button>
        <button onMouseDown={onClear} title="Clear this panel"
                className="p-1 rounded-[5px] cursor-pointer hover:bg-[rgba(212,83,126,0.15)]"
                style={{ color: 'rgba(212,83,126,0.7)' }}>
          <X size={12} />
        </button>
      </div>
    </div>
  )
}

// ── Resizable grid ────────────────────────────────────────────────────────────
function ResizableGrid({
  layout, panelItems, onRemoveItem, onAssignItem, isFullscreen,
  perPanelMode = false, panelLabels = {}, perPanelShuffle = {},
  onLoadPanel, onClearPanel, onTogglePanelShuffle,
  deviceConnected = false, deviceSyncPanel = null, onToggleDeviceSync,
}) {
  const { rows } = layout
  const numRows  = rows.length
  const numCols  = rows[0].length

  const [rowSizes, setRowSizes] = useState(() => Array(numRows).fill(100 / numRows))
  // Each row has its own independent column widths — resizing a column in row N
  // does NOT affect columns in any other row.
  const [colSizesByRow, setColSizesByRow] = useState(() =>
    Array(numRows).fill(null).map(() => Array(numCols).fill(100 / numCols))
  )

  useEffect(() => {
    setRowSizes(Array(numRows).fill(100 / numRows))
    setColSizesByRow(Array(numRows).fill(null).map(() => Array(numCols).fill(100 / numCols)))
  }, [layout.count])

  const [dragOverIdx, setDragOverIdx] = useState(null)
  const containerRef = useRef(null)

  const startRowDrag = useCallback((rowIdx, e) => {
    e.preventDefault()
    const startY   = e.clientY
    const snapshot = [...rowSizes]
    const totalH   = containerRef.current?.clientHeight || 1
    const onMove = (ev) => {
      const delta = ((ev.clientY - startY) / totalH) * 100
      const dClamped = Math.max(-(snapshot[rowIdx] - 8), Math.min(snapshot[rowIdx + 1] - 8, delta))
      setRowSizes(prev => {
        const n = [...prev]
        n[rowIdx]     = snapshot[rowIdx]     + dClamped
        n[rowIdx + 1] = snapshot[rowIdx + 1] - dClamped
        return n
      })
    }
    const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [rowSizes])

  const startColDrag = useCallback((rowIdx, colIdx, e) => {
    e.preventDefault()
    const startX   = e.clientX
    const snapshot = [...colSizesByRow[rowIdx]]
    const totalW   = containerRef.current?.clientWidth || 1
    const onMove = (ev) => {
      const delta = ((ev.clientX - startX) / totalW) * 100
      const dClamped = Math.max(-(snapshot[colIdx] - 8), Math.min(snapshot[colIdx + 1] - 8, delta))
      setColSizesByRow(prev => {
        const next = prev.map(row => [...row])
        next[rowIdx][colIdx]     = snapshot[colIdx]     + dClamped
        next[rowIdx][colIdx + 1] = snapshot[colIdx + 1] - dClamped
        return next
      })
    }
    const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [colSizesByRow])

  return (
    <div ref={containerRef} className="flex-1 flex flex-col overflow-hidden" style={{ userSelect: 'none' }}>
      {rows.map((row, rowIdx) => (
        <React.Fragment key={rowIdx}>
          <div className="flex min-h-0" style={{ height: `${rowSizes[rowIdx]}%` }}>
            {row.map((panelIdx, colIdx) => (
              <React.Fragment key={colIdx}>
                <div style={{ width: `${colSizesByRow[rowIdx]?.[colIdx] ?? (100 / numCols)}%`, minWidth: 0, height: '100%', position: 'relative' }}
                     onDragOver={e => {
                       e.preventDefault()
                       if (dragOverIdx !== panelIdx) setDragOverIdx(panelIdx)
                     }}
                     onDragLeave={() => setDragOverIdx(null)}
                     onDrop={e => {
                       e.preventDefault()
                       setDragOverIdx(null)
                       const id = e.dataTransfer.getData('text/plain')
                       if (id) onAssignItem(id, panelIdx)
                     }}>
                  {dragOverIdx === panelIdx && (
                    <div className="absolute inset-0 z-50 pointer-events-none" style={{ background: 'rgba(127,119,221,0.2)', border: '2px dashed #7F77DD' }} />
                  )}
                  {perPanelMode ? (
                    // Header row + player stacked, so the bar never overlaps the
                    // player's own zoom/nav controls.
                    <div className="flex flex-col h-full">
                      <PanelPlaylistBar
                        panelIdx={panelIdx}
                        label={panelLabels[panelIdx]}
                        count={(panelItems[panelIdx] ?? []).length}
                        shuffled={!!perPanelShuffle[panelIdx]}
                        onLoad={() => onLoadPanel?.(panelIdx)}
                        onClear={() => onClearPanel?.(panelIdx)}
                        onToggleShuffle={() => onTogglePanelShuffle?.(panelIdx)}
                      />
                      <div className="flex-1 min-h-0">
                        <PanelCell
                          panelIndex={panelIdx}
                          items={panelItems[panelIdx] ?? []}
                          onRemoveItem={onRemoveItem}
                          isFullscreen={isFullscreen}
                          deviceConnected={deviceConnected}
                          deviceSynced={deviceSyncPanel === panelIdx}
                          onToggleDeviceSync={() => onToggleDeviceSync?.(panelIdx)}
                        />
                      </div>
                    </div>
                  ) : (
                    <PanelCell
                      panelIndex={panelIdx}
                      items={panelItems[panelIdx] ?? []}
                      onRemoveItem={onRemoveItem}
                      isFullscreen={isFullscreen}
                      deviceConnected={deviceConnected}
                      deviceSynced={deviceSyncPanel === panelIdx}
                      onToggleDeviceSync={() => onToggleDeviceSync?.(panelIdx)}
                    />
                  )}
                </div>
                {colIdx < row.length - 1 && (
                  <div
                    className="flex-shrink-0 relative group cursor-col-resize z-10"
                    style={{ width: 5, background: 'rgba(255,255,255,0.04)' }}
                    onMouseDown={e => startColDrag(rowIdx, colIdx, e)}>
                    <div className="absolute inset-0 group-hover:bg-[rgba(127,119,221,0.45)] transition-colors duration-150" />
                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      {[0,1,2].map(i => <div key={i} className="w-1 h-1 rounded-full" style={{ background: 'rgba(255,255,255,0.6)' }} />)}
                    </div>
                  </div>
                )}
              </React.Fragment>
            ))}
          </div>
          {rowIdx < rows.length - 1 && (
            <div
              className="flex-shrink-0 relative group cursor-row-resize z-10"
              style={{ height: 5, background: 'rgba(255,255,255,0.04)' }}
              onMouseDown={e => startRowDrag(rowIdx, e)}>
              <div className="absolute inset-0 group-hover:bg-[rgba(127,119,221,0.45)] transition-colors duration-150" />
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-row gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                {[0,1,2].map(i => <div key={i} className="w-1 h-1 rounded-full" style={{ background: 'rgba(255,255,255,0.6)' }} />)}
              </div>
            </div>
          )}
        </React.Fragment>
      ))}
    </div>
  )
}

// ── Playlists Modal ───────────────────────────────────────────────────────────
//
// The multi-panel queue IS the playlist — this just persists and restores it,
// along with the viewer setup (panel count + playback mode) so a saved session
// comes back exactly as it was left.
function PlaylistsModal({ onClose, queue, layoutIdx, galleryMode, onLoad, manualAssignments = {}, targetPanel = null }) {
  const qc = useQueryClient()
  const [name, setName]           = useState('')
  const [renamingId, setRenaming] = useState(null)
  const [renameVal, setRenameVal] = useState('')
  const [confirmDel, setConfirm]  = useState(null)
  const [busy, setBusy]           = useState(false)

  const { data: playlists = [], isLoading } = useQuery({
    queryKey: ['panel-playlists'],
    queryFn: () => panelPlaylistsApi.list().then(r => r.data),
  })

  // In per-panel mode each entry carries the panel it's pinned to, so reloading
  // this playlist rebuilds the whole arrangement rather than a flat list.
  const payload = (nm) => ({
    name: nm,
    layout_idx: layoutIdx,
    gallery_mode: galleryMode,
    entries: queue.map(item => ({
      entry_type: item.type,
      ref_id: item.media.id,
      panel_idx: galleryMode === 'per-panel' ? (manualAssignments[item.id] ?? null) : null,
    })),
  })

  const refresh = () => qc.invalidateQueries({ queryKey: ['panel-playlists'] })

  const handleSaveNew = async () => {
    const nm = name.trim()
    if (!nm || !queue.length || busy) return
    setBusy(true)
    try {
      await panelPlaylistsApi.create(payload(nm))
      toast.success(`Saved “${nm}”`)
      setName('')
      refresh()
    } catch { toast.error('Could not save playlist') }
    setBusy(false)
  }

  const handleOverwrite = async (pl) => {
    if (!queue.length || busy) return
    setBusy(true)
    try {
      await panelPlaylistsApi.update(pl.id, payload(pl.name))
      toast.success(`Updated “${pl.name}”`)
      refresh()
    } catch { toast.error('Could not update playlist') }
    setBusy(false)
  }

  const handleLoad = async (pl, mode) => {
    if (busy) return
    setBusy(true)
    try {
      const { data } = await panelPlaylistsApi.get(pl.id)
      onLoad(data, mode, targetPanel)
      toast.success(
        targetPanel !== null ? `“${pl.name}” → panel ${targetPanel + 1}`
        : mode === 'append'  ? `Appended “${pl.name}”`
        : `Loaded “${pl.name}”`
      )
      onClose()
    } catch { toast.error('Could not load playlist') }
    setBusy(false)
  }

  const handleRename = async (pl) => {
    const nm = renameVal.trim()
    if (!nm) return
    try {
      await panelPlaylistsApi.rename(pl.id, nm)
      setRenaming(null)
      refresh()
    } catch { toast.error('Could not rename') }
  }

  const handleDelete = async (pl) => {
    try {
      await panelPlaylistsApi.delete(pl.id)
      setConfirm(null)
      refresh()
      toast.success(`Deleted “${pl.name}”`)
    } catch { toast.error('Could not delete') }
  }

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center animate-fade-in"
         style={{ background: 'rgba(0,0,0,0.8)' }}
         onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="flex flex-col rounded-[16px] overflow-hidden shadow-2xl animate-modal-pop"
           style={{ width: 'clamp(380px, 52vw, 760px)', height: 'clamp(380px, 66vh, 780px)', background: '#161616', border: '0.5px solid rgba(255,255,255,0.12)' }}>

        <div className="flex items-center gap-2 px-4 py-3 border-b border-[rgba(255,255,255,0.07)]">
          <ListMusic size={15} style={{ color: '#CECBF6' }} />
          <span className="text-[15px] font-medium text-[rgba(255,255,255,0.85)]">
            {targetPanel !== null ? `Load into panel ${targetPanel + 1}` : 'Playlists'}
          </span>
          <span className="text-[13px] text-[rgba(255,255,255,0.35)] ml-1">
            {targetPanel !== null
              ? 'pick a playlist for this panel'
              : `${queue.length} item${queue.length === 1 ? '' : 's'} in the current queue`}
          </span>
          <button onMouseDown={onClose} className="cursor-pointer text-[rgba(255,255,255,0.35)] hover:text-white ml-auto"><X size={15} /></button>
        </div>

        {/* Save current queue — hidden when picking a playlist for one panel */}
        {targetPanel === null && (
        <div className="px-4 py-3 border-b border-[rgba(255,255,255,0.07)]">
          <div className="text-[13px] text-[rgba(255,255,255,0.4)] uppercase tracking-wider mb-2">Save current queue</div>
          <div className="flex items-center gap-2">
            <input value={name} onChange={e => setName(e.target.value)}
                   onKeyDown={e => e.key === 'Enter' && handleSaveNew()}
                   placeholder={queue.length ? 'Playlist name…' : 'Queue is empty'}
                   disabled={!queue.length}
                   className="flex-1 px-3 py-2 rounded-[8px] outline-none text-[16px] disabled:opacity-40"
                   style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.85)', border: '0.5px solid rgba(255,255,255,0.12)' }} />
            <button onMouseDown={handleSaveNew} disabled={!name.trim() || !queue.length || busy}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-[8px] text-[14px] font-medium cursor-pointer disabled:opacity-30"
                    style={{ background: 'rgba(127,119,221,0.25)', color: '#CECBF6', border: '0.5px solid rgba(127,119,221,0.45)' }}>
              <Save size={13} /> Save
            </button>
          </div>
          <div className="text-[13px] text-[rgba(255,255,255,0.28)] mt-1.5">
            {galleryMode === 'per-panel'
              ? `Saves which panel each item plays in, across your ${LAYOUTS[layoutIdx]?.label ?? ''} panels.`
              : `Saves the order, plus your ${LAYOUTS[layoutIdx]?.label ?? ''}-panel layout and ${galleryMode === 'grouped' ? 'grouped' : 'shuffled'} playback.`}
          </div>
        </div>
        )}

        {/* Saved playlists */}
        <div className="flex-1 overflow-y-auto px-4 py-3">
          <div className="text-[13px] text-[rgba(255,255,255,0.4)] uppercase tracking-wider mb-2">Saved</div>
          {isLoading ? (
            <div className="text-[14px] text-[rgba(255,255,255,0.3)] py-6 text-center">Loading…</div>
          ) : playlists.length === 0 ? (
            <div className="text-[14px] text-[rgba(255,255,255,0.28)] py-8 text-center">
              No saved playlists yet.<br />Queue some media, name it above, and hit Save.
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              {playlists.map(pl => (
                <div key={pl.id} className="rounded-[10px] px-3 py-2.5"
                     style={{ background: 'rgba(255,255,255,0.04)', border: `0.5px solid ${pl.is_autosave ? 'rgba(186,117,23,0.35)' : 'rgba(255,255,255,0.08)'}` }}>
                  <div className="flex items-center gap-2.5">
                    {/* Cover stack */}
                    <div className="flex -space-x-2 flex-shrink-0">
                      {(pl.covers ?? []).slice(0, 3).map((c, i) => (
                        <img key={i} src={c} alt="" className="w-9 h-9 rounded-[5px] object-cover"
                             style={{ border: '1px solid #161616' }}
                             onError={e => { e.target.style.visibility = 'hidden' }} />
                      ))}
                      {(!pl.covers || pl.covers.length === 0) && (
                        <div className="w-9 h-9 rounded-[5px] flex items-center justify-center"
                             style={{ background: 'rgba(255,255,255,0.05)' }}>
                          <ListMusic size={13} style={{ color: 'rgba(255,255,255,0.25)' }} />
                        </div>
                      )}
                    </div>

                    <div className="flex-1 min-w-0">
                      {renamingId === pl.id ? (
                        <input autoFocus value={renameVal}
                               onChange={e => setRenameVal(e.target.value)}
                               onKeyDown={e => { if (e.key === 'Enter') handleRename(pl); if (e.key === 'Escape') setRenaming(null) }}
                               onBlur={() => setRenaming(null)}
                               className="w-full px-2 py-1 rounded-[6px] outline-none text-[15px]"
                               style={{ background: 'rgba(255,255,255,0.08)', color: '#fff', border: '0.5px solid rgba(127,119,221,0.5)' }} />
                      ) : (
                        <div className="flex items-center gap-1.5">
                          <span className="text-[15px] text-[rgba(255,255,255,0.85)] truncate">{pl.name}</span>
                          {pl.is_autosave && (
                            <span className="text-[11px] px-1.5 py-0.5 rounded-full flex-shrink-0"
                                  style={{ background: 'rgba(186,117,23,0.2)', color: '#FAC775' }}>auto</span>
                          )}
                        </div>
                      )}
                      <div className="text-[13px] text-[rgba(255,255,255,0.35)] mt-0.5">
                        {pl.gallery_count} galler{pl.gallery_count === 1 ? 'y' : 'ies'} · {pl.image_count} file{pl.image_count === 1 ? '' : 's'}
                        {pl.panels_used?.length > 0
                          ? ` · arrangement across ${pl.panels_used.length} panel${pl.panels_used.length === 1 ? '' : 's'}`
                          : ` · ${LAYOUTS[pl.layout_idx]?.label ?? '?'} panels · ${pl.gallery_mode}`}
                      </div>
                    </div>

                    {confirmDel === pl.id ? (
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button onMouseDown={() => handleDelete(pl)}
                                className="px-2 py-1 rounded-[6px] text-[13px] cursor-pointer"
                                style={{ background: 'rgba(212,83,126,0.25)', color: '#F4C0D1' }}>Delete</button>
                        <button onMouseDown={() => setConfirm(null)}
                                className="px-2 py-1 rounded-[6px] text-[13px] cursor-pointer"
                                style={{ color: 'rgba(255,255,255,0.4)' }}>Cancel</button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button onMouseDown={() => handleLoad(pl, 'replace')} disabled={busy}
                                title={targetPanel !== null
                                  ? `Play this in panel ${targetPanel + 1}`
                                  : 'Replace the current queue with this playlist'}
                                className="flex items-center gap-1 px-2.5 py-1.5 rounded-[7px] text-[13px] font-medium cursor-pointer disabled:opacity-40"
                                style={{ background: 'rgba(127,119,221,0.25)', color: '#CECBF6', border: '0.5px solid rgba(127,119,221,0.4)' }}>
                          <Play size={11} /> Load
                        </button>
                        {targetPanel === null && (
                          <button onMouseDown={() => handleLoad(pl, 'append')} disabled={busy}
                                  title="Add this playlist to the end of the current queue"
                                  className="p-1.5 rounded-[6px] cursor-pointer hover:bg-[rgba(255,255,255,0.06)]"
                                  style={{ color: 'rgba(255,255,255,0.45)' }}>
                            <Plus size={13} />
                          </button>
                        )}
                        {targetPanel === null && (
                          <button onMouseDown={() => handleOverwrite(pl)} disabled={!queue.length || busy}
                                  title="Overwrite with the current queue"
                                  className="p-1.5 rounded-[6px] cursor-pointer hover:bg-[rgba(255,255,255,0.06)] disabled:opacity-25"
                                  style={{ color: 'rgba(255,255,255,0.45)' }}>
                            <Save size={13} />
                          </button>
                        )}
                        <button onMouseDown={() => { setRenaming(pl.id); setRenameVal(pl.name) }}
                                title={pl.is_autosave ? 'Rename — also keeps it from being auto-overwritten' : 'Rename'}
                                className="p-1.5 rounded-[6px] cursor-pointer hover:bg-[rgba(255,255,255,0.06)]"
                                style={{ color: 'rgba(255,255,255,0.45)' }}>
                          <Pencil size={13} />
                        </button>
                        <button onMouseDown={() => setConfirm(pl.id)}
                                title="Delete"
                                className="p-1.5 rounded-[6px] cursor-pointer hover:bg-[rgba(212,83,126,0.12)]"
                                style={{ color: 'rgba(212,83,126,0.7)' }}>
                          <Trash2 size={13} />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Add Media Modal ───────────────────────────────────────────────────────────
function AddMediaModal({ onClose }) {
  const [tab, setTab]         = useState('galleries')
  const [search, setSearch]   = useState('')
  const [galleryId, setGalleryId] = useState(null)
  const [loadingGalId, setLoadingGalId] = useState(null)
  
  const addToMultiViewer = useVaultStore(s => s.addToMultiViewer)
  const queue            = useVaultStore(s => s.multiViewerQueue)
  const MAX              = useVaultStore(s => s.MULTIVIEWER_MAX)

  const { data: galleries } = useQuery({
    queryKey: ['galleries-mini-mv'],
    queryFn: () => galleriesApi.list({ limit: 500 }).then(r => r.data),
    enabled: tab === 'galleries',
  })
  const { data: galleryImages } = useQuery({
    queryKey: ['gallery-images-mv', galleryId],
    queryFn: () => galleriesApi.images(galleryId).then(r => r.data),
    enabled: !!galleryId,
  })
  const { data: allImages } = useQuery({
    queryKey: ['images-mv', tab],
    queryFn: () => imagesApi.list({ is_video: tab === 'videos', limit: 200, sort_by: 'rating' }).then(r => r.data),
    enabled: tab === 'images' || tab === 'videos',
  })

  const filtered = useMemo(() => {
    const s = search.toLowerCase()
    if (galleryId) return (galleryImages ?? []).filter(i => i.filename.toLowerCase().includes(s))
    if (tab === 'galleries') return (galleries ?? []).filter(g => g.name.toLowerCase().includes(s))
    return (allImages ?? []).filter(i => i.filename.toLowerCase().includes(s))
  }, [tab, search, galleries, galleryImages, allImages, galleryId])

  const queuedIds = new Set(queue.map(q => q.id))
  const atMax = queue.length >= MAX

  const handleAddImage = (img) => {
    if (atMax) { toast.error(`Max ${MAX} items reached`); return }
    const ok = addToMultiViewer({ id: `img-${img.id}`, type: 'image', media: img })
    if (!ok) toast.error('Already in queue or queue full')
    else toast.success('Added to multi-viewer')
  }

  const handleAddGallery = async (e, g) => {
    e.stopPropagation()
    if (atMax) { toast.error(`Max ${MAX} items reached`); return }
    
    setLoadingGalId(g.id)
    try {
      const res = await galleriesApi.images(g.id)
      const ok = addToMultiViewer({ id: `gal-${g.id}`, type: 'gallery', media: g, images: res.data })
      if (!ok) toast.error('Already in queue or queue full')
      else toast.success('Added gallery to multi-viewer')
    } catch (err) {
      toast.error('Failed to load gallery images')
    } finally {
      setLoadingGalId(null)
    }
  }

  const displayList = galleryId ? (galleryImages ?? []) : filtered

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center animate-fade-in"
         style={{ background: 'rgba(0,0,0,0.8)' }}
         onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="flex flex-col rounded-[16px] overflow-hidden shadow-2xl animate-modal-pop"
           style={{ width: 'clamp(380px, 60vw, 960px)', height: 'clamp(380px, 60vh, 820px)', background: '#161616', border: '0.5px solid rgba(255,255,255,0.12)' }}>
        <div className="flex items-center gap-2 px-4 py-3 border-b border-[rgba(255,255,255,0.07)]">
          {galleryId ? (
            <button onMouseDown={() => { setGalleryId(null); setSearch('') }}
                    className="text-[11px] cursor-pointer text-[rgba(255,255,255,0.45)] hover:text-white flex items-center gap-1">
              <ChevronDown size={12} className="rotate-90" /> Back
            </button>
          ) : (
            <div className="flex gap-1">
              {[{ id: 'galleries', icon: Images, label: 'Galleries' },
                { id: 'images',    icon: Images, label: 'Photos'    },
                { id: 'videos',    icon: Video,  label: 'Videos'    }].map(t => (
                <button key={t.id} onMouseDown={() => { setTab(t.id); setSearch('') }}
                        className="flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] cursor-pointer"
                        style={tab === t.id
                          ? { background: 'rgba(127,119,221,0.25)', color: '#CECBF6', border: '0.5px solid rgba(127,119,221,0.4)' }
                          : { background: 'transparent', color: 'rgba(255,255,255,0.4)' }}>
                  <t.icon size={11} />{t.label}
                </button>
              ))}
            </div>
          )}
          <div className="flex-1 flex items-center gap-2 px-2.5 py-1 rounded-full mx-2"
               style={{ background: 'rgba(255,255,255,0.06)', border: '0.5px solid rgba(255,255,255,0.1)' }}>
            <Search size={11} className="text-[rgba(255,255,255,0.3)]" />
            <input autoFocus value={search} onChange={e => setSearch(e.target.value)}
                   placeholder="Search…"
                   className="bg-transparent text-[11px] outline-none text-[rgba(255,255,255,0.8)] placeholder-[rgba(255,255,255,0.25)] w-full" />
          </div>
          <span className="text-[10px] text-[rgba(255,255,255,0.35)]">{queue.length}/{MAX}</span>
          <button onMouseDown={onClose} className="cursor-pointer text-[rgba(255,255,255,0.35)] hover:text-white ml-1"><X size={15} /></button>
        </div>
        
        <div className="flex-1 overflow-y-auto p-2">
          {tab === 'galleries' && !galleryId ? (
            <div className="grid grid-cols-3 gap-2">
              {filtered.map(g => {
                const inQ = queuedIds.has(`gal-${g.id}`)
                return (
                  <button key={g.id} onMouseDown={() => { setGalleryId(g.id); setSearch('') }}
                          className="relative rounded-[10px] overflow-hidden cursor-pointer group text-left"
                          style={{ aspectRatio: '1', background: 'rgba(255,255,255,0.04)', border: '0.5px solid rgba(255,255,255,0.08)' }}>
                    {g.cover_thumb && <img src={g.cover_thumb} alt={g.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200" />}
                    <div className="absolute inset-0 flex items-end p-1.5" style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.8), transparent)' }}>
                      <span className="text-[9px] text-white font-medium leading-tight line-clamp-2">{g.name}</span>
                    </div>
                    {/* Add entire gallery button */}
                    <div onMouseDown={(e) => !inQ && handleAddGallery(e, g)}
                         className="absolute top-1 right-1 w-6 h-6 rounded-full flex items-center justify-center cursor-pointer transition-opacity z-10"
                         style={{ 
                           background: inQ ? 'rgba(127,119,221,0.7)' : 'rgba(0,0,0,0.6)',
                           opacity: inQ ? 1 : 0 
                         }}
                         onMouseEnter={e => { if(!inQ) e.currentTarget.style.opacity = '1' }}
                         onMouseLeave={e => { if(!inQ) e.currentTarget.style.opacity = '0' }}>
                      {loadingGalId === g.id ? (
                        <span className="w-3 h-3 border-2 border-[rgba(255,255,255,0.3)] border-t-white rounded-full animate-spin" />
                      ) : inQ ? (
                        <span className="text-[10px] text-white">✓</span>
                      ) : (
                        <Plus size={12} color="#fff" />
                      )}
                    </div>
                  </button>
                )
              })}
            </div>
          ) : (
            <div className="grid grid-cols-4 gap-1.5">
              {displayList.map(img => {
                const inQ = queuedIds.has(`img-${img.id}`)
                return (
                  <button key={img.id} onMouseDown={() => !inQ && handleAddImage(img)}
                          className="relative rounded-[8px] overflow-hidden cursor-pointer group"
                          style={{ aspectRatio: '1', background: 'rgba(255,255,255,0.04)',
                            border: `0.5px solid ${inQ ? 'rgba(127,119,221,0.5)' : 'rgba(255,255,255,0.07)'}`,
                            opacity: inQ ? 0.6 : 1 }}>
                    <img src={`/api/images/${img.id}/thumb`} alt="" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200" onError={e => { e.target.style.display = 'none' }} />
                    {img.is_video && (
                      <div className="absolute top-1 left-1 w-4 h-4 rounded-full flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.7)' }}>
                        <Video size={8} color="#fff" />
                      </div>
                    )}
                    {inQ
                      ? <div className="absolute inset-0 flex items-center justify-center" style={{ background: 'rgba(127,119,221,0.25)' }}><span className="text-[9px] font-medium text-[#CECBF6]">✓</span></div>
                      : <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity" style={{ background: 'rgba(0,0,0,0.4)' }}><Plus size={18} color="rgba(255,255,255,0.8)" /></div>
                    }
                  </button>
                )
              })}
            </div>
          )}
          {atMax && <div className="text-center text-[11px] py-3" style={{ color: '#F4C0D1' }}>Queue full ({MAX}/{MAX})</div>}
        </div>
      </div>
    </div>
  )
}

// ── Queue strip ───────────────────────────────────────────────────────────────
// The strip stays small while you're actually watching, and grows only when the
// pointer enters it — so playback order is legible when you care and out of the
// way when you don't. Dragging a tile onto another tile reorders playback
// (left → right); dragging one onto a panel still pins it there.
function QueueStrip({ queue, manualAssignments, onRemove, onClear, onReorder }) {
  const [hovered, setHovered]   = useState(false)
  const [dragIdx, setDragIdx]   = useState(null)
  const [overIdx, setOverIdx]   = useState(null)

  if (!queue.length) return null

  const TILE = hovered ? 84 : 34
  const strip = hovered ? 104 : 44

  const endDrag = () => { setDragIdx(null); setOverIdx(null) }

  return (
    <div className="flex items-center gap-1.5 px-2 overflow-x-auto overflow-y-hidden flex-shrink-0"
         onMouseEnter={() => setHovered(true)}
         onMouseLeave={() => { setHovered(false); endDrag() }}
         style={{
           height: strip,
           borderBottom: '0.5px solid rgba(255,255,255,0.06)',
           transition: 'height 180ms cubic-bezier(0.4, 0, 0.2, 1)',
         }}>
      {queue.map((item, i) => {
        const thumbSrc = item.type === 'gallery'
          ? item.media.cover_thumb
          : `/api/images/${item.media.id}/thumb`
        const isVid = item.type === 'image' && item.media.is_video
        const badge  = hovered ? 18 : 12
        const isDragging = dragIdx === i
        const showLeftMarker = overIdx === i && dragIdx !== null && dragIdx !== i

        return (
          <React.Fragment key={`${item.id}#${i}`}>
            {/* Insertion marker */}
            <div style={{
              width: showLeftMarker ? 3 : 0,
              height: TILE,
              background: '#7F77DD',
              borderRadius: 2,
              flexShrink: 0,
              transition: 'width 120ms ease',
            }} />

            <div draggable={true}
                 onDragStart={e => {
                   e.dataTransfer.setData('text/plain', item.id)
                   e.dataTransfer.effectAllowed = 'copyMove'
                   setDragIdx(i)
                 }}
                 onDragEnd={endDrag}
                 onDragOver={e => {
                   // Only intercept when reordering within the strip — a drag that
                   // started on a panel or elsewhere falls through untouched.
                   if (dragIdx === null) return
                   e.preventDefault()
                   e.stopPropagation()
                   e.dataTransfer.dropEffect = 'move'
                   if (overIdx !== i) setOverIdx(i)
                 }}
                 onDrop={e => {
                   if (dragIdx === null) return
                   e.preventDefault()
                   e.stopPropagation()
                   if (dragIdx !== i) onReorder(dragIdx, i)
                   endDrag()
                 }}
                 className="relative flex-shrink-0 rounded-[6px] overflow-hidden cursor-grab active:cursor-grabbing group"
                 style={{
                   width: TILE, height: TILE,
                   border: '0.5px solid rgba(255,255,255,0.1)',
                   opacity: isDragging ? 0.4 : 1,
                   transition: 'width 180ms cubic-bezier(0.4, 0, 0.2, 1), height 180ms cubic-bezier(0.4, 0, 0.2, 1), opacity 120ms ease',
                 }}>
              <img src={thumbSrc} alt="" className="w-full h-full object-cover pointer-events-none" onError={e => { e.target.style.display = 'none' }} />
              {isVid && (
                <div className="absolute top-0.5 left-0.5 rounded-full flex items-center justify-center pointer-events-none"
                     style={{ width: badge, height: badge, background: 'rgba(0,0,0,0.7)' }}>
                  <Video size={hovered ? 11 : 7} color="#fff" />
                </div>
              )}
              {item.type === 'gallery' && (
                <div className="absolute top-0.5 left-0.5 rounded-[3px] flex items-center justify-center pointer-events-none"
                     style={{ width: badge, height: badge, background: 'rgba(127,119,221,0.7)' }}>
                  <Images size={hovered ? 11 : 7} color="#fff" />
                </div>
              )}
              {manualAssignments[item.id] !== undefined && (
                <div className="absolute top-0 left-0 px-1 bg-[#7F77DD] text-white rounded-br-[4px] font-bold z-10 pointer-events-none"
                     style={{ fontSize: hovered ? 13 : 9, boxShadow: '1px 1px 3px rgba(0,0,0,0.5)' }}>
                  P{manualAssignments[item.id] + 1}
                </div>
              )}
              <button onClick={(e) => { e.stopPropagation(); onRemove(item.id) }}
                      className="absolute top-0 right-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer z-20"
                      style={{ width: hovered ? 22 : 16, height: hovered ? 22 : 16, background: 'rgba(212,83,126,0.9)', borderBottomLeftRadius: '4px' }}
                      title="Remove from queue">
                <X size={hovered ? 14 : 10} color="#fff" />
              </button>
              <div className="absolute bottom-0 left-0 right-0 flex items-center justify-center pointer-events-none tabular-nums"
                   style={{
                     height: hovered ? 20 : 11,
                     background: 'rgba(0,0,0,0.65)',
                     fontSize: hovered ? 16 : 8,
                     color: hovered ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.4)',
                     transition: 'height 180ms ease, font-size 180ms ease',
                   }}>
                {i + 1}
              </div>
            </div>
          </React.Fragment>
        )
      })}

      {/* Trailing drop zone — lets you drag a tile to the very end */}
      <div style={{ width: overIdx === queue.length && dragIdx !== null ? 3 : 0, height: TILE, background: '#7F77DD', borderRadius: 2, flexShrink: 0, transition: 'width 120ms ease' }} />
      <div onDragOver={e => { if (dragIdx === null) return; e.preventDefault(); e.stopPropagation(); if (overIdx !== queue.length) setOverIdx(queue.length) }}
           onDrop={e => {
             if (dragIdx === null) return
             e.preventDefault(); e.stopPropagation()
             onReorder(dragIdx, queue.length - 1)
             endDrag()
           }}
           style={{ width: 16, height: TILE, flexShrink: 0 }} />

      <button onMouseDown={onClear} className="flex-shrink-0 rounded-full flex items-center justify-center cursor-pointer ml-1"
              style={{ width: hovered ? 34 : 26, height: hovered ? 34 : 26, background: 'rgba(212,83,126,0.12)', border: '0.5px solid rgba(212,83,126,0.25)', transition: 'width 180ms ease, height 180ms ease' }}
              title="Clear all">
        <Trash2 size={hovered ? 15 : 11} color="#F4C0D1" />
      </button>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function MultiPanel() {
  const queue            = useVaultStore(s => s.multiViewerQueue)
  const removeFromViewer = useVaultStore(s => s.removeFromMultiViewer)
  const clearViewer      = useVaultStore(s => s.clearMultiViewer)
  const reorderViewer    = useVaultStore(s => s.reorderMultiViewer)
  const addXpToast       = useVaultStore(s => s.addXpToast)
  const MAX                    = useVaultStore(s => s.MULTIVIEWER_MAX)
  const sessionActive          = useVaultStore(s => s.sessionActive)
  const startSession           = useVaultStore(s => s.startSession)
  const endSession             = useVaultStore(s => s.endSession)
  const setMultiPanelFullscreen = useVaultStore(s => s.setMultiPanelFullscreen)

  const setQueue         = useVaultStore(s => s.setMultiViewerQueue)
  const appendQueue      = useVaultStore(s => s.appendMultiViewerQueue)

  const [layoutIdx, setLayoutIdx]   = useState(2)   // default: 3 cols
  const [showAdd, setShowAdd]       = useState(false)
  const [showPlaylists, setShowPlaylists] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const isFullscreenRef             = useRef(false)
  const [showTopBar, setShowTopBar] = useState(true)
  const topBarTimer                 = useRef(null)

  const [galleryMode, setGalleryMode] = useState('grouped') // 'grouped' | 'shuffled' | 'per-panel'
  // Per-panel mode only: which panels shuffle their own playlist, and a label
  // per panel so you can see which playlist each one is running.
  const [perPanelShuffle, setPerPanelShuffle] = useState({})
  const [panelLabels, setPanelLabels]         = useState({})
  const [loadTarget, setLoadTarget]           = useState(null)  // panel idx awaiting a playlist
  // Which panel currently drives the connected device. Exclusive by design —
  // one toy can only follow one video, so claiming a panel releases the previous.
  const [deviceSyncPanel, setDeviceSyncPanel] = useState(null)
  const [showMenu, setShowMenu] = useState(false)
  const [showDevicePanel, setShowDevicePanel] = useState(false)
  const [manualAssignments, setManualAssignments] = useState({})
  const menuRef = useRef(null)
  const deviceBtnRef = useRef(null)

  const deviceStatus = useDeviceStore(s => s.status)

  const layout     = LAYOUTS[layoutIdx] ?? LAYOUTS[2]
  const panelItems = useMemo(
    () => distributeItems(queue, layout.count, galleryMode, manualAssignments, perPanelShuffle),
    [queue, layout.count, galleryMode, manualAssignments, perPanelShuffle],
  )

  // Clean up assignments when removing
  const handleRemoveFromViewer = useCallback((id) => {
    setManualAssignments(prev => { const n = { ...prev }; delete n[id]; return n })
    removeFromViewer(id)
  }, [removeFromViewer])

  const handleClearViewer = useCallback(() => {
    setManualAssignments({})
    clearViewer()
  }, [clearViewer])

  const handleAssignItem = useCallback((itemId, panelIdx) => {
    setManualAssignments(prev => ({ ...prev, [itemId]: panelIdx }))
  }, [])

  // ── Per-panel mode helpers ─────────────────────────────────────────────────
  // A panel's playlist is expressed through manualAssignments (itemId → panel),
  // the same mechanism drag-onto-panel already uses — so pinning, the queue
  // strip, reordering and session logging all keep working unchanged.
  const assignItemsToPanel = useCallback((items, panelIdx, label) => {
    appendQueue(items)
    setManualAssignments(prev => {
      const next = { ...prev }
      items.forEach(i => { next[i.id] = panelIdx })
      return next
    })
    if (label) setPanelLabels(prev => ({ ...prev, [panelIdx]: label }))
  }, [appendQueue])

  // Leaving per-panel mode releases its panel bindings, otherwise every item
  // stays pinned and the shared modes have nothing left to distribute — the
  // mode switch would look like it did nothing. Drag-pins made in the shared
  // modes are untouched, since grouped ↔ shuffled doesn't pass through here.
  const changeGalleryMode = useCallback((next) => {
    setGalleryMode(prev => {
      if (prev === 'per-panel' && next !== 'per-panel') {
        setManualAssignments({})
        setPanelLabels({})
        setPerPanelShuffle({})
      }
      return next
    })
  }, [])

  const clearPanel = useCallback((panelIdx) => {
    // Drop every item pinned to this panel from both the queue and the pin map
    const doomed = Object.entries(manualAssignments)
      .filter(([, p]) => p === panelIdx)
      .map(([itemId]) => itemId)
    doomed.forEach(id => removeFromViewer(id))
    setManualAssignments(prev => {
      const next = { ...prev }
      doomed.forEach(id => delete next[id])
      return next
    })
    setPanelLabels(prev => { const n = { ...prev }; delete n[panelIdx]; return n })
    setPerPanelShuffle(prev => { const n = { ...prev }; delete n[panelIdx]; return n })
  }, [manualAssignments, removeFromViewer])

  // Rehydrate a saved playlist back into queue-item shape. 'replace' also
  // restores the saved viewer setup; 'append' leaves the current setup alone
  // since the user is adding to a session already in progress.
  const handleLoadPlaylist = useCallback((data, mode, targetPanel = null) => {
    const entries = data.entries ?? []
    const items = entries.map(e => ({
      id:     e.entry_type === 'gallery' ? `gal-${e.ref_id}` : `img-${e.ref_id}`,
      type:   e.entry_type,
      media:  e.media,
      images: e.images ?? [],
    }))

    // Loading into one specific panel — everything lands there regardless of
    // how the playlist was originally saved.
    if (targetPanel !== null) {
      assignItemsToPanel(items, targetPanel, data.name)
      setGalleryMode('per-panel')
      return
    }

    if (mode === 'append') {
      appendQueue(items)
      return
    }

    setManualAssignments({})
    setPanelLabels({})
    setPerPanelShuffle({})
    setQueue(items)
    if (typeof data.layout_idx === 'number' && LAYOUTS[data.layout_idx]) setLayoutIdx(data.layout_idx)
    if (data.gallery_mode) setGalleryMode(data.gallery_mode)

    // A saved multi-panel arrangement restores each entry to its own panel.
    const pinned = {}
    entries.forEach((e, i) => {
      if (e.panel_idx !== null && e.panel_idx !== undefined) pinned[items[i].id] = e.panel_idx
    })
    if (Object.keys(pinned).length) setManualAssignments(pinned)
  }, [appendQueue, setQueue, assignItemsToPanel])

  // Rolling autosave — the queue lives only in memory, so a reload or crash
  // would otherwise throw away a long session's worth of curation. Debounced so
  // rapid add/reorder bursts collapse into one write.
  const autosaveTimer = useRef(null)
  useEffect(() => {
    if (!queue.length) return
    clearTimeout(autosaveTimer.current)
    autosaveTimer.current = setTimeout(() => {
      panelPlaylistsApi.autosave({
        name: 'Last session',
        layout_idx: layoutIdx,
        gallery_mode: galleryMode,
        entries: queue.map(item => ({
          entry_type: item.type,
          ref_id: item.media.id,
          panel_idx: galleryMode === 'per-panel' ? (manualAssignments[item.id] ?? null) : null,
        })),
      }).catch(() => {})
    }, 2500)
    return () => clearTimeout(autosaveTimer.current)
  }, [queue, layoutIdx, galleryMode, manualAssignments])

  const wrapperRef = useRef(null)

  const enterFullscreen = useCallback(() => {
    isFullscreenRef.current = true
    setIsFullscreen(true)
    setMultiPanelFullscreen(true)
    setShowTopBar(true)
    clearTimeout(topBarTimer.current)
    topBarTimer.current = setTimeout(() => setShowTopBar(false), 2500)
    if (window.pywebview?.api) {
      window.pywebview.api.toggle_fullscreen()
    } else {
      wrapperRef.current?.requestFullscreen()
    }
  }, [setMultiPanelFullscreen])

  const exitFullscreen = useCallback(() => {
    isFullscreenRef.current = false
    setIsFullscreen(false)
    setMultiPanelFullscreen(false)
    setShowTopBar(true)
    clearTimeout(topBarTimer.current)
    if (window.pywebview?.api) {
      window.pywebview.api.toggle_fullscreen()
    } else {
      document.exitFullscreen()
    }
  }, [setMultiPanelFullscreen])

  const toggleFullscreen = useCallback(() => {
    if (isFullscreenRef.current) exitFullscreen()
    else enterFullscreen()
  }, [enterFullscreen, exitFullscreen])

  useEffect(() => {
    const handler = () => {
      const fs = !!document.fullscreenElement
      isFullscreenRef.current = fs
      setIsFullscreen(fs)
      setMultiPanelFullscreen(fs)
      if (fs) {
        setShowTopBar(true)
        clearTimeout(topBarTimer.current)
        topBarTimer.current = setTimeout(() => setShowTopBar(false), 2500)
      } else {
        setShowTopBar(true)
        clearTimeout(topBarTimer.current)
      }
    }
    document.addEventListener('fullscreenchange', handler)
    return () => document.removeEventListener('fullscreenchange', handler)
  }, [setMultiPanelFullscreen])

  useEffect(() => {
    if (!window.pywebview?.api) return
    const handler = (e) => {
      if (e.key === 'Escape' && isFullscreenRef.current) exitFullscreen()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [exitFullscreen])

  // Reset global fullscreen flag when navigating away
  useEffect(() => {
    return () => { setMultiPanelFullscreen(false) }
  }, [setMultiPanelFullscreen])

  const handleMouseMove = useCallback(() => {
    if (!isFullscreenRef.current) return
    setShowTopBar(true)
    clearTimeout(topBarTimer.current)
    topBarTimer.current = setTimeout(() => setShowTopBar(false), 2500)
  }, [])

  // Close options menu on outside click
  useEffect(() => {
    const handler = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setShowMenu(false)
      // DeviceControls uses a portal that renders to document.body, so the preset
      // dropdown options are outside deviceBtnRef in the DOM. Guard against that by
      // ignoring clicks on any portal element (z-index 9999 fixed-position children).
      if (deviceBtnRef.current && !deviceBtnRef.current.contains(e.target)) {
        const isPortal = e.target.closest('[data-portal]')
        if (!isPortal) setShowDevicePanel(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Drop the device claim if the toy goes away or the layout shrinks past the
  // synced panel, so a stale claim can't block re-syncing to a visible panel.
  useEffect(() => {
    if (deviceSyncPanel === null) return
    if (deviceStatus !== 'connected' || deviceSyncPanel >= layout.count) setDeviceSyncPanel(null)
  }, [deviceStatus, deviceSyncPanel, layout.count])

  const sessionMutation = useMutation({
    mutationFn: (data = {}) => sessionsApi.log(data).then(r => r.data),
    // Only show XP toast for the primary session (skip_xp=false ones have xp_earned=0)
    onSuccess: (data) => { if (data.xp_earned > 0) addXpToast(`+${data.xp_earned} XP`) },
  })

  const wrapperClass = isFullscreen
    ? 'flex flex-col w-full h-full relative'
    : 'flex flex-col h-full relative'

  return (
    <div ref={wrapperRef} className={wrapperClass} style={{ background: '#080808' }} onMouseMove={handleMouseMove}>

      {/* Top bar + queue strip — absolute overlay in fullscreen, normal flow otherwise */}
      <div style={isFullscreen ? {
        position: 'absolute', top: 0, left: 0, right: 0, zIndex: 50,
        opacity: showTopBar ? 1 : 0,
        pointerEvents: showTopBar ? 'auto' : 'none',
        transition: 'opacity 0.3s ease',
      } : { flexShrink: 0 }}>

      {/* Top bar */}
      <div className="flex items-center gap-2 px-3"
           style={{ height: 44, borderBottom: '0.5px solid rgba(255,255,255,0.07)', background: '#111', flexShrink: 0 }}>

        <span className="text-[12px] font-medium text-[rgba(255,255,255,0.7)] mr-1">Playlists / Multi panel</span>

        {/* Layout picker */}
        <div className="flex items-center gap-0.5 px-1.5 py-1 rounded-[8px]"
             style={{ background: 'rgba(255,255,255,0.05)', border: '0.5px solid rgba(255,255,255,0.08)' }}>
          {LAYOUTS.map((l, i) => (
            <button key={l.count} onMouseDown={() => setLayoutIdx(i)}
                    className="px-2 py-0.5 rounded-[5px] text-[11px] cursor-pointer font-mono"
                    style={layoutIdx === i
                      ? { background: 'rgba(127,119,221,0.3)', color: '#CECBF6' }
                      : { color: 'rgba(255,255,255,0.4)' }}>
              {l.label}
            </button>
          ))}
        </div>

        <span className="text-[10px] text-[rgba(255,255,255,0.3)] tabular-nums">{queue.length}/{MAX}</span>

        <button onMouseDown={() => setShowAdd(true)}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] cursor-pointer"
                style={{ background: 'rgba(127,119,221,0.2)', color: '#CECBF6', border: '0.5px solid rgba(127,119,221,0.35)' }}>
          <Plus size={12} /> Add media
        </button>

        <button onMouseDown={() => setShowPlaylists(true)}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] cursor-pointer"
                style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.6)', border: '0.5px solid rgba(255,255,255,0.12)' }}
                title="Save or load a playlist">
          <ListMusic size={12} /> Playlists
        </button>

        {/* Options Menu */}
        <div ref={menuRef} className="relative">
          <button onMouseDown={() => setShowMenu(m => !m)}
                  className="cursor-pointer p-1.5 rounded-[6px] transition-colors hover:bg-[rgba(255,255,255,0.05)]"
                  style={{ color: showMenu ? '#CECBF6' : 'rgba(255,255,255,0.4)' }}>
            <MoreVertical size={14} />
          </button>
          {showMenu && (
            <div className="absolute top-full left-0 mt-1 rounded-[10px] overflow-hidden shadow-2xl z-50 w-48 animate-menu-pop"
                 style={{ background: '#1e1e1e', border: '0.5px solid rgba(255,255,255,0.12)' }}>
              <div className="px-3 py-2 text-[10px] text-[rgba(255,255,255,0.4)] border-b border-[rgba(255,255,255,0.06)] uppercase tracking-wider">
                Gallery Playback
              </div>
              <button onMouseDown={() => { changeGalleryMode('grouped'); setShowMenu(false) }}
                      className="w-full flex items-center gap-2 px-3 py-2.5 text-[11px] cursor-pointer hover:bg-[rgba(255,255,255,0.05)]"
                      style={{ color: galleryMode === 'grouped' ? '#CECBF6' : 'rgba(255,255,255,0.7)' }}>
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: galleryMode === 'grouped' ? '#7F77DD' : 'transparent' }} />
                Keep grouped in panel
              </button>
              <button onMouseDown={() => { changeGalleryMode('shuffled'); setShowMenu(false) }}
                      className="w-full flex items-center gap-2 px-3 py-2.5 text-[11px] cursor-pointer hover:bg-[rgba(255,255,255,0.05)]"
                      style={{ color: galleryMode === 'shuffled' ? '#CECBF6' : 'rgba(255,255,255,0.7)' }}>
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: galleryMode === 'shuffled' ? '#7F77DD' : 'transparent' }} />
                Shuffle with all media
              </button>
              <button onMouseDown={() => { changeGalleryMode('per-panel'); setShowMenu(false) }}
                      className="w-full flex items-start gap-2 px-3 py-2.5 text-[11px] cursor-pointer hover:bg-[rgba(255,255,255,0.05)]"
                      style={{ color: galleryMode === 'per-panel' ? '#CECBF6' : 'rgba(255,255,255,0.7)' }}>
                <span className="w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0" style={{ background: galleryMode === 'per-panel' ? '#7F77DD' : 'transparent' }} />
                <span className="text-left">
                  Per-panel playlists
                  <span className="block text-[10px] text-[rgba(255,255,255,0.35)] mt-0.5">
                    Each panel plays its own
                  </span>
                </span>
              </button>
            </div>
          )}
        </div>

        {/* Device controls — popover anchored to a button, only when connected */}
        {deviceStatus === 'connected' && (
          <div ref={deviceBtnRef} className="relative">
            <button
              onMouseDown={() => setShowDevicePanel(v => !v)}
              className="flex items-center gap-1.5 px-2 py-1 rounded text-[11px] cursor-pointer transition-colors"
              style={showDevicePanel
                ? { background: 'rgba(127,119,221,0.25)', color: '#CECBF6', border: '0.5px solid rgba(127,119,221,0.4)' }
                : { background: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.5)', border: '0.5px solid rgba(255,255,255,0.1)' }}>
              <Sliders size={12} />
              Device
            </button>
            {showDevicePanel && (
              <div className="absolute top-full right-0 mt-1.5 z-[200]" style={{ width: 260 }}>
                <DeviceControls />
              </div>
            )}
          </div>
        )}

        <div className="ml-auto flex items-center gap-2">
          <button onMouseDown={() => {
            if (sessionActive) {
              const elapsed = endSession()
              const dur = Math.floor(elapsed / 1000)

              // Build a gallery_id → creator_id map from queue metadata
              const galleryCreatorMap = {}
              queue.forEach(item => {
                if (item.type === 'gallery' && item.media?.id != null) {
                  galleryCreatorMap[item.media.id] = item.media.creator_id ?? null
                } else if (item.type === 'image' && item.media?.gallery_id != null) {
                  if (!(item.media.gallery_id in galleryCreatorMap))
                    galleryCreatorMap[item.media.gallery_id] = null
                }
              })

              // Collect one entry per unique creator from panels that are ACTIVELY SHOWING content
              // (panelItems, not the full queue — queued-but-not-displayed creators don't count)
              const seenKeys = new Set()
              const sessionsToLog = []
              panelItems.forEach(panel => {
                panel.forEach(img => {
                  const gid = img?.gallery_id
                  if (!gid) return
                  const cid = galleryCreatorMap[gid] ?? null
                  const key = cid != null ? `c-${cid}` : `g-${gid}`
                  if (!seenKeys.has(key)) {
                    seenKeys.add(key)
                    const entry = { gallery_id: gid }
                    if (cid != null) entry.creator_id = cid
                    sessionsToLog.push(entry)
                  }
                })
              })

              if (sessionsToLog.length === 0) {
                sessionMutation.mutate({ duration_sec: dur })
              } else {
                // First entry gets XP; the rest are logged silently with skip_xp
                sessionsToLog.forEach((s, i) => {
                  sessionMutation.mutate({ duration_sec: dur, ...s, skip_xp: i > 0 })
                })
              }
              toast.success('Session logged ❤️')
            } else {
              startSession()
              toast.success('Session started ❤️')
            }
          }}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] cursor-pointer"
                  style={{ background: 'rgba(212,83,126,0.2)', color: '#F4C0D1', border: '0.5px solid rgba(212,83,126,0.35)' }}>
            <Heart size={12} /> {sessionActive ? 'Stop Session' : 'Start Session'}
          </button>

          <button onClick={toggleFullscreen}
                  className="cursor-pointer p-1.5 rounded-[6px] transition-colors"
                  style={{ color: isFullscreen ? '#CECBF6' : 'rgba(255,255,255,0.4)',
                           background: isFullscreen ? 'rgba(127,119,221,0.2)' : 'transparent' }}
                  title={isFullscreen ? 'Exit fullscreen (Esc)' : 'Fullscreen'}>
            {isFullscreen ? <Minimize size={14} /> : <Maximize size={14} />}
          </button>
        </div>
      </div>

      {/* Queue strip */}
      <QueueStrip queue={queue} manualAssignments={manualAssignments} onRemove={handleRemoveFromViewer} onClear={handleClearViewer} onReorder={reorderViewer} />

      </div>{/* end topbar overlay wrapper */}

      {/* Empty state — skipped in per-panel mode, where empty panels are the
          entry point for loading a playlist into each one. */}
      {queue.length === 0 && galleryMode !== 'per-panel' ? (
        <div className="flex-1 flex items-center justify-center flex-col gap-4">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center"
               style={{ background: 'rgba(127,119,221,0.1)', border: '0.5px solid rgba(127,119,221,0.2)' }}>
            <LayoutGrid size={28} style={{ color: 'rgba(127,119,221,0.5)' }} />
          </div>
          <div className="text-center">
            <div className="text-[15px] font-medium text-[rgba(255,255,255,0.6)] mb-1">No media queued</div>
            <div className="text-[12px] text-[rgba(255,255,255,0.25)] mb-4">
              Add media here, or use the <span style={{ color: '#CECBF6' }}>⊞ Send to viewer</span> button<br/>
              while browsing Images and Videos.
            </div>
            <div className="flex items-center gap-2 justify-center">
              <button onMouseDown={() => setShowAdd(true)}
                      className="flex items-center gap-2 px-4 py-2 rounded-full text-[12px] cursor-pointer"
                      style={{ background: 'rgba(127,119,221,0.25)', color: '#CECBF6', border: '0.5px solid rgba(127,119,221,0.4)' }}>
                <Plus size={14} /> Add media
              </button>
              <button onMouseDown={() => setShowPlaylists(true)}
                      className="flex items-center gap-2 px-4 py-2 rounded-full text-[12px] cursor-pointer"
                      style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.6)', border: '0.5px solid rgba(255,255,255,0.14)' }}>
                <ListMusic size={14} /> Load a playlist
              </button>
            </div>
          </div>
        </div>
      ) : (
        <ResizableGrid
          layout={layout}
          panelItems={panelItems}
          onRemoveItem={handleRemoveFromViewer}
          onAssignItem={handleAssignItem}
          isFullscreen={isFullscreen}
          perPanelMode={galleryMode === 'per-panel'}
          panelLabels={panelLabels}
          perPanelShuffle={perPanelShuffle}
          onLoadPanel={(idx) => { setLoadTarget(idx); setShowPlaylists(true) }}
          onClearPanel={clearPanel}
          onTogglePanelShuffle={(idx) => setPerPanelShuffle(p => ({ ...p, [idx]: !p[idx] }))}
          deviceConnected={deviceStatus === 'connected'}
          deviceSyncPanel={deviceSyncPanel}
          onToggleDeviceSync={(idx) => setDeviceSyncPanel(p => (p === idx ? null : idx))}
        />
      )}

      {showAdd && <AddMediaModal onClose={() => setShowAdd(false)} />}
      {showPlaylists && (
        <PlaylistsModal
          onClose={() => { setShowPlaylists(false); setLoadTarget(null) }}
          queue={queue}
          layoutIdx={layoutIdx}
          galleryMode={galleryMode}
          manualAssignments={manualAssignments}
          targetPanel={loadTarget}
          onLoad={handleLoadPlaylist}
        />
      )}
    </div>
  )
}

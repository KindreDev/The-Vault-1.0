import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import {
  Plus, Trash2, X, Heart, Search, Video, Images,
  Maximize, Minimize, ChevronDown, LayoutGrid, MoreVertical, Sliders,
} from 'lucide-react'
import { useVaultStore } from '../store/vault'
import { useDeviceStore } from '../store/deviceStore'
import { galleriesApi, imagesApi, sessionsApi } from '../lib/api'
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

function distributeItems(queue, panelCount, mode, manualAssignments) {
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

// ── Resizable grid ────────────────────────────────────────────────────────────
function ResizableGrid({ layout, panelItems, onRemoveItem, onAssignItem, isFullscreen }) {
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
                  <PanelCell
                    panelIndex={panelIdx}
                    items={panelItems[panelIdx] ?? []}
                    onRemoveItem={onRemoveItem}
                    isFullscreen={isFullscreen}
                  />
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
function QueueStrip({ queue, manualAssignments, onRemove, onClear }) {
  if (!queue.length) return null
  return (
    <div className="flex items-center gap-1.5 px-2 overflow-x-auto flex-shrink-0"
         style={{ height: 52, borderBottom: '0.5px solid rgba(255,255,255,0.06)' }}>
      {queue.map((item, i) => {
        const thumbSrc = item.type === 'gallery' 
          ? item.media.cover_thumb 
          : `/api/images/${item.media.id}/thumb`
        const isVid = item.type === 'image' && item.media.is_video
        
        return (
          <div key={item.id} 
               draggable={true}
               onDragStart={e => {
                 e.dataTransfer.setData('text/plain', item.id)
                 e.dataTransfer.effectAllowed = 'copyMove'
                 e.currentTarget.style.opacity = '0.5'
               }}
               onDragEnd={e => { e.currentTarget.style.opacity = '1' }}
               className="relative flex-shrink-0 rounded-[6px] overflow-hidden cursor-grab active:cursor-grabbing group"
               style={{ width: 40, height: 40, border: '0.5px solid rgba(255,255,255,0.1)' }}>
            <img src={thumbSrc} alt="" className="w-full h-full object-cover pointer-events-none" onError={e => { e.target.style.display = 'none' }} />
            {isVid && (
              <div className="absolute top-0.5 left-0.5 w-3 h-3 rounded-full flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.7)' }}>
                <Video size={6} color="#fff" />
              </div>
            )}
            {item.type === 'gallery' && (
              <div className="absolute top-0.5 left-0.5 w-3 h-3 rounded-[3px] flex items-center justify-center" style={{ background: 'rgba(127,119,221,0.7)' }}>
                <Images size={6} color="#fff" />
              </div>
            )}
            {manualAssignments[item.id] !== undefined && (
              <div className="absolute top-0 left-0 px-1 bg-[#7F77DD] text-white rounded-br-[4px] font-bold z-10 pointer-events-none"
                   style={{ fontSize: '9px', boxShadow: '1px 1px 3px rgba(0,0,0,0.5)' }}>
                P{manualAssignments[item.id] + 1}
              </div>
            )}
            <button onClick={(e) => { e.stopPropagation(); onRemove(item.id) }}
                    className="absolute top-0 right-0 w-4 h-4 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer z-20"
                    style={{ background: 'rgba(212,83,126,0.9)', borderBottomLeftRadius: '4px' }}
                    title="Remove from queue">
              <X size={10} color="#fff" />
            </button>
            <div className="absolute bottom-0 left-0 right-0 flex items-center justify-center"
                 style={{ height: 10, background: 'rgba(0,0,0,0.6)', fontSize: 7, color: 'rgba(255,255,255,0.4)' }}>
              {i + 1}
            </div>
          </div>
        )
      })}
      <button onMouseDown={onClear} className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center cursor-pointer ml-1"
              style={{ background: 'rgba(212,83,126,0.12)', border: '0.5px solid rgba(212,83,126,0.25)' }} title="Clear all">
        <Trash2 size={11} color="#F4C0D1" />
      </button>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function MultiPanel() {
  const queue            = useVaultStore(s => s.multiViewerQueue)
  const removeFromViewer = useVaultStore(s => s.removeFromMultiViewer)
  const clearViewer      = useVaultStore(s => s.clearMultiViewer)
  const addXpToast       = useVaultStore(s => s.addXpToast)
  const MAX              = useVaultStore(s => s.MULTIVIEWER_MAX)
  const sessionActive    = useVaultStore(s => s.sessionActive)
  const startSession     = useVaultStore(s => s.startSession)
  const endSession       = useVaultStore(s => s.endSession)

  const [layoutIdx, setLayoutIdx]   = useState(2)   // default: 3 cols
  const [showAdd, setShowAdd]       = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  
  const [galleryMode, setGalleryMode] = useState('grouped') // 'grouped' | 'shuffled'
  const [showMenu, setShowMenu] = useState(false)
  const [showDevicePanel, setShowDevicePanel] = useState(false)
  const [manualAssignments, setManualAssignments] = useState({})
  const menuRef = useRef(null)
  const deviceBtnRef = useRef(null)

  const deviceStatus = useDeviceStore(s => s.status)

  const layout     = LAYOUTS[layoutIdx] ?? LAYOUTS[2]
  const panelItems = useMemo(() => distributeItems(queue, layout.count, galleryMode, manualAssignments), [queue, layout.count, galleryMode, manualAssignments])

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

  const wrapperRef = useRef(null)

  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      wrapperRef.current?.requestFullscreen()
    } else {
      document.exitFullscreen()
    }
  }, [])

  useEffect(() => {
    const handler = () => {
      setIsFullscreen(!!document.fullscreenElement)
    }
    document.addEventListener('fullscreenchange', handler)
    return () => document.removeEventListener('fullscreenchange', handler)
  }, [])

  // Close options menu on outside click
  useEffect(() => {
    const handler = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setShowMenu(false)
      if (deviceBtnRef.current && !deviceBtnRef.current.contains(e.target)) setShowDevicePanel(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const sessionMutation = useMutation({
    mutationFn: (data = {}) => sessionsApi.log(data).then(r => r.data),
    onSuccess: (data) => { addXpToast(`+${data.xp_earned} XP`); toast.success('Session logged ❤️') },
  })

  const wrapperClass = isFullscreen
    ? 'flex flex-col w-full h-full'
    : 'flex flex-col h-full'

  return (
    <div ref={wrapperRef} className={wrapperClass} style={{ background: '#080808' }}>

      {/* Top bar */}
      <div className="flex items-center gap-2 px-3 flex-shrink-0"
           style={{ height: 44, borderBottom: '0.5px solid rgba(255,255,255,0.07)', background: '#111' }}>

        <span className="text-[12px] font-medium text-[rgba(255,255,255,0.7)] mr-1">Multi panel view</span>

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
              <button onMouseDown={() => { setGalleryMode('grouped'); setShowMenu(false) }}
                      className="w-full flex items-center gap-2 px-3 py-2.5 text-[11px] cursor-pointer hover:bg-[rgba(255,255,255,0.05)]"
                      style={{ color: galleryMode === 'grouped' ? '#CECBF6' : 'rgba(255,255,255,0.7)' }}>
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: galleryMode === 'grouped' ? '#7F77DD' : 'transparent' }} />
                Keep grouped in panel
              </button>
              <button onMouseDown={() => { setGalleryMode('shuffled'); setShowMenu(false) }}
                      className="w-full flex items-center gap-2 px-3 py-2.5 text-[11px] cursor-pointer hover:bg-[rgba(255,255,255,0.05)]"
                      style={{ color: galleryMode === 'shuffled' ? '#CECBF6' : 'rgba(255,255,255,0.7)' }}>
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: galleryMode === 'shuffled' ? '#7F77DD' : 'transparent' }} />
                Shuffle with all media
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
              sessionMutation.mutate({ duration_sec: Math.floor(elapsed / 1000) })
              toast.success('Session stopped')
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
      <QueueStrip queue={queue} manualAssignments={manualAssignments} onRemove={handleRemoveFromViewer} onClear={handleClearViewer} />

      {/* Empty state */}
      {queue.length === 0 ? (
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
            <button onMouseDown={() => setShowAdd(true)}
                    className="flex items-center gap-2 px-4 py-2 rounded-full text-[12px] cursor-pointer mx-auto"
                    style={{ background: 'rgba(127,119,221,0.25)', color: '#CECBF6', border: '0.5px solid rgba(127,119,221,0.4)' }}>
              <Plus size={14} /> Add media
            </button>
          </div>
        </div>
      ) : (
        <ResizableGrid
          layout={layout}
          panelItems={panelItems}
          onRemoveItem={handleRemoveFromViewer}
          onAssignItem={handleAssignItem}
          isFullscreen={isFullscreen}
        />
      )}

      {showAdd && <AddMediaModal onClose={() => setShowAdd(false)} />}
    </div>
  )
}

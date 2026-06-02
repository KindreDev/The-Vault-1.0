import React, { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Shuffle, X, Tag, Search, ChevronDown, Check } from 'lucide-react'
import { creatorsApi, galleriesApi, tagsApi } from '../lib/api'
import toast from 'react-hot-toast'

const MAX_TAGS = 10

// ── Reusable custom dropdown ──────────────────────────────────────────────────
// Portals the list to document.body so it is never affected by a transformed
// ancestor (animate-modal-pop uses transform, which breaks position:fixed).
function CustomSelect({ value, onChange, options, placeholder }) {
  const [open, setOpen] = useState(false)
  const [pos,  setPos]  = useState({ top: 0, left: 0, width: 0 })
  const triggerRef = useRef(null)
  const dropRef    = useRef(null)

  const openDropdown = () => {
    if (triggerRef.current) {
      const r = triggerRef.current.getBoundingClientRect()
      setPos({ top: r.bottom + 4, left: r.left, width: r.width })
    }
    setOpen(v => !v)
  }

  useEffect(() => {
    if (!open) return
    const handler = (e) => {
      if (
        triggerRef.current && !triggerRef.current.contains(e.target) &&
        dropRef.current    && !dropRef.current.contains(e.target)
      ) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const selected = options.find(o => String(o.value) === String(value))

  const dropdown = open && createPortal(
    <div ref={dropRef}
         className="rounded-[8px] overflow-y-auto animate-dropdown-in origin-top"
         style={{ position: 'fixed', top: pos.top, left: pos.left, width: pos.width, zIndex: 99999,
                  background: '#1c1c1c', border: '0.5px solid rgba(255,255,255,0.12)',
                  maxHeight: 200, scrollbarWidth: 'none', boxShadow: '0 8px 24px rgba(0,0,0,0.6)' }}>
      {options.map(o => {
        const isActive = String(o.value) === String(value)
        return (
          <button key={o.value} type="button"
                  onMouseDown={() => { onChange(o.value); setOpen(false) }}
                  className="w-full text-left px-3 py-2 text-[13px] cursor-pointer flex items-center justify-between transition-colors hover:bg-[rgba(127,119,221,0.12)]"
                  style={{ color: isActive ? '#CECBF6' : 'rgba(255,255,255,0.75)', background: isActive ? 'rgba(127,119,221,0.08)' : 'transparent' }}>
            <span className="truncate">{o.label}</span>
            {isActive && <Check size={12} style={{ color: '#7F77DD', flexShrink: 0 }} />}
          </button>
        )
      })}
    </div>,
    document.body
  )

  return (
    <div>
      <button ref={triggerRef} type="button" onMouseDown={openDropdown}
              className="w-full flex items-center justify-between px-3 py-2 rounded-[8px] text-[13px] cursor-pointer outline-none"
              style={{ background: 'rgba(255,255,255,0.06)', border: `0.5px solid ${open ? 'rgba(127,119,221,0.5)' : 'rgba(255,255,255,0.12)'}`, color: selected ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.35)', transition: 'border-color 150ms' }}>
        <span className="truncate">{selected ? selected.label : placeholder}</span>
        <ChevronDown size={13} className="flex-shrink-0 ml-2 transition-transform duration-150"
                     style={{ color: 'rgba(255,255,255,0.35)', transform: open ? 'rotate(180deg)' : 'rotate(0deg)' }} />
      </button>
      {dropdown}
    </div>
  )
}

// ── Main modal ────────────────────────────────────────────────────────────────
export default function RandomMixModal({ onClose }) {
  const navigate = useNavigate()

  const { data: creators } = useQuery({
    queryKey: ['creators-simple'],
    queryFn: () => creatorsApi.list({ limit: 200 }).then(r => r.data),
  })

  const { data: allTags } = useQuery({
    queryKey: ['tags-all'],
    queryFn: () => tagsApi.list().then(r => r.data),
  })

  const [count,        setCount]        = useState(50)
  const [contentType,  setContentType]  = useState('all')
  const [name,         setName]         = useState('')
  const [busy,         setBusy]         = useState(false)

  // Creator multi-select state
  const [selectedCreators, setSelectedCreators] = useState([])  // [{ id, name }]
  const [creatorSearch,    setCreatorSearch]    = useState('')
  const [creatorOpen,      setCreatorOpen]      = useState(false)
  const creatorRef = useRef(null)

  useEffect(() => {
    if (!creatorOpen) return
    const handler = (e) => {
      if (creatorRef.current && !creatorRef.current.contains(e.target)) setCreatorOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [creatorOpen])

  const filteredCreators = (creators ?? []).filter(c => {
    if (selectedCreators.some(s => s.id === c.id)) return false
    if (!creatorSearch.trim()) return true
    return c.name.toLowerCase().includes(creatorSearch.toLowerCase())
  })

  const addCreator = (c) => {
    setSelectedCreators(prev => [...prev, { id: c.id, name: c.name }])
    setCreatorSearch('')
    setCreatorOpen(false)
  }

  const removeCreator = (id) => setSelectedCreators(prev => prev.filter(c => c.id !== id))

  // Tag picker state
  const [selectedTags, setSelectedTags] = useState([])   // [{ id, name }]
  const [tagSearch,    setTagSearch]    = useState('')
  const [tagOpen,      setTagOpen]      = useState(false)
  const tagRef = useRef(null)

  // Close tag dropdown on outside click
  useEffect(() => {
    if (!tagOpen) return
    const handler = (e) => {
      if (tagRef.current && !tagRef.current.contains(e.target)) setTagOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [tagOpen])

  const filteredTags = (allTags ?? []).filter(t => {
    if (selectedTags.some(s => s.id === t.id)) return false
    if (!tagSearch.trim()) return true
    return t.name.toLowerCase().includes(tagSearch.toLowerCase())
  })

  const addTag = (tag) => {
    if (selectedTags.length >= MAX_TAGS) return
    setSelectedTags(prev => [...prev, { id: tag.id, name: tag.name }])
    setTagSearch('')
    setTagOpen(false)
  }

  const removeTag = (id) => setSelectedTags(prev => prev.filter(t => t.id !== id))

  const handleGenerate = async () => {
    setBusy(true)
    try {
      const res = await galleriesApi.randomMix({
        count,
        creator_ids: selectedCreators.map(c => c.id),
        photos_only: contentType === 'photos',
        videos_only: contentType === 'videos',
        tag_ids:     selectedTags.map(t => t.id),
        name:        name.trim() || undefined,
      })
      toast.success(`"${res.data.name}" created — ${res.data.image_count} items`)
      onClose()
      navigate(`/galleries/${res.data.id}`)
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Could not generate mix')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center animate-fade-in"
         style={{ background: 'rgba(0,0,0,0.80)' }}
         onMouseDown={onClose}>
      <div className="rounded-[16px] shadow-2xl animate-modal-pop flex flex-col"
           style={{ width: 440, maxHeight: '90vh', background: '#1a1a1a', border: '0.5px solid rgba(127,119,221,0.4)' }}
           onMouseDown={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center gap-2.5 px-5 py-4 flex-shrink-0"
             style={{ borderBottom: '0.5px solid rgba(255,255,255,0.07)' }}>
          <Shuffle size={15} style={{ color: '#7F77DD' }} />
          <div className="flex-1 text-[15px] font-medium text-[rgba(255,255,255,0.9)]">Generate Random Mix</div>
          <button onMouseDown={onClose} className="cursor-pointer text-[rgba(255,255,255,0.3)] hover:text-white">
            <X size={14} />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="p-5 flex flex-col gap-4 overflow-y-auto" style={{ scrollbarWidth: 'none' }}>

          {/* Name */}
          <div>
            <label className="block text-[12px] text-[rgba(255,255,255,0.5)] mb-1.5">
              Name <span className="opacity-50">(optional)</span>
            </label>
            <input value={name} onChange={e => setName(e.target.value)}
                   placeholder="Auto-generated if blank"
                   className="w-full px-3 py-2 rounded-[8px] text-[13px] outline-none"
                   style={{ background: 'rgba(255,255,255,0.06)', border: '0.5px solid rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.85)' }} />
          </div>

          {/* Count */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-[12px] text-[rgba(255,255,255,0.5)]">Items</label>
              <span className="text-[14px] font-medium" style={{ color: '#7F77DD' }}>{count}</span>
            </div>
            <input type="range" min={5} max={300} step={5} value={count}
                   onChange={e => setCount(Number(e.target.value))}
                   className="w-full cursor-pointer accent-[var(--c-accent)]" />
            <div className="flex justify-between text-[10px] text-[rgba(255,255,255,0.25)] mt-0.5">
              <span>5</span><span>150</span><span>300</span>
            </div>
          </div>

          {/* Creator multi-select */}
          <div ref={creatorRef}>
            <label className="block text-[12px] text-[rgba(255,255,255,0.5)] mb-1.5">
              Creators <span className="opacity-50">(blank = any)</span>
            </label>

            {/* Selected creator chips */}
            {selectedCreators.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {selectedCreators.map(c => (
                  <span key={c.id}
                        className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px]"
                        style={{ background: 'rgba(127,119,221,0.2)', color: '#CECBF6', border: '0.5px solid rgba(127,119,221,0.4)' }}>
                    {c.name}
                    <button onMouseDown={() => removeCreator(c.id)}
                            className="cursor-pointer opacity-60 hover:opacity-100 ml-0.5">
                      <X size={10} />
                    </button>
                  </span>
                ))}
              </div>
            )}

            {/* Search input */}
            <div className="relative">
              <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                      style={{ color: 'rgba(255,255,255,0.3)' }} />
              <input
                value={creatorSearch}
                onChange={e => { setCreatorSearch(e.target.value); setCreatorOpen(true) }}
                onFocus={() => setCreatorOpen(true)}
                placeholder={selectedCreators.length === 0 ? 'Search creators…' : 'Add another…'}
                className="w-full pl-8 pr-3 py-2 rounded-[8px] text-[12px] outline-none"
                style={{ background: 'rgba(255,255,255,0.06)', border: '0.5px solid rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.85)' }}
              />
            </div>

            {/* Creator dropdown */}
            {creatorOpen && filteredCreators.length > 0 && (
              <div className="mt-1 rounded-[8px] overflow-y-auto animate-dropdown-in origin-top"
                   style={{ background: '#1c1c1c', border: '0.5px solid rgba(255,255,255,0.12)', maxHeight: 152, scrollbarWidth: 'none', boxShadow: '0 8px 24px rgba(0,0,0,0.5)' }}>
                {filteredCreators.slice(0, 40).map(c => (
                  <button key={c.id}
                          onMouseDown={() => addCreator(c)}
                          className="w-full text-left px-3 py-1.5 text-[12px] cursor-pointer hover:bg-[rgba(127,119,221,0.12)] transition-colors"
                          style={{ color: 'rgba(255,255,255,0.75)' }}>
                    {c.name}
                  </button>
                ))}
              </div>
            )}

            {creatorOpen && creatorSearch.trim() && filteredCreators.length === 0 && (
              <div className="mt-1 px-3 py-2 rounded-[8px] text-[12px] animate-dropdown-in origin-top"
                   style={{ background: '#1c1c1c', border: '0.5px solid rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.3)' }}>
                No creators match "{creatorSearch}"
              </div>
            )}
          </div>

          {/* Tags */}
          <div ref={tagRef}>
            <div className="flex items-center justify-between mb-1.5">
              <label className="flex items-center gap-1.5 text-[12px] text-[rgba(255,255,255,0.5)]">
                <Tag size={11} /> Preferred tags <span className="opacity-50">(optional)</span>
              </label>
              {selectedTags.length > 0 && (
                <span className="text-[11px]"
                      style={{ color: selectedTags.length >= MAX_TAGS ? '#E24B4A' : 'rgba(255,255,255,0.3)' }}>
                  {selectedTags.length}/{MAX_TAGS}
                </span>
              )}
            </div>

            {/* Selected tag chips */}
            {selectedTags.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {selectedTags.map(t => (
                  <span key={t.id}
                        className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px]"
                        style={{ background: 'rgba(127,119,221,0.2)', color: '#CECBF6', border: '0.5px solid rgba(127,119,221,0.4)' }}>
                    {t.name}
                    <button onMouseDown={() => removeTag(t.id)}
                            className="cursor-pointer opacity-60 hover:opacity-100 ml-0.5">
                      <X size={10} />
                    </button>
                  </span>
                ))}
              </div>
            )}

            {/* Search input */}
            <div className="relative">
              <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                      style={{ color: 'rgba(255,255,255,0.3)' }} />
              <input
                value={tagSearch}
                onChange={e => { setTagSearch(e.target.value); setTagOpen(true) }}
                onFocus={() => setTagOpen(true)}
                placeholder={selectedTags.length >= MAX_TAGS ? `Max ${MAX_TAGS} tags selected` : 'Search tags…'}
                disabled={selectedTags.length >= MAX_TAGS}
                className="w-full pl-8 pr-3 py-2 rounded-[8px] text-[12px] outline-none disabled:opacity-40"
                style={{ background: 'rgba(255,255,255,0.06)', border: '0.5px solid rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.85)' }}
              />
            </div>

            {/* Tag dropdown list */}
            {tagOpen && filteredTags.length > 0 && selectedTags.length < MAX_TAGS && (
              <div className="mt-1 rounded-[8px] overflow-y-auto animate-dropdown-in origin-top"
                   style={{ background: '#1c1c1c', border: '0.5px solid rgba(255,255,255,0.12)', maxHeight: 152, scrollbarWidth: 'none', boxShadow: '0 8px 24px rgba(0,0,0,0.5)' }}>
                {filteredTags.slice(0, 40).map(t => (
                  <button key={t.id}
                          onMouseDown={() => addTag(t)}
                          className="w-full text-left px-3 py-1.5 text-[12px] cursor-pointer hover:bg-[rgba(127,119,221,0.12)] transition-colors flex items-center justify-between"
                          style={{ color: 'rgba(255,255,255,0.75)' }}>
                    <span>{t.name}</span>
                    {(t.use_count ?? 0) > 0 && (
                      <span style={{ color: 'rgba(255,255,255,0.25)', fontSize: 11 }}>{t.use_count}</span>
                    )}
                  </button>
                ))}
              </div>
            )}

            {tagOpen && tagSearch.trim() && filteredTags.length === 0 && selectedTags.length < MAX_TAGS && (
              <div className="mt-1 px-3 py-2 rounded-[8px] text-[12px] animate-dropdown-in origin-top"
                   style={{ background: '#1c1c1c', border: '0.5px solid rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.3)' }}>
                No tags match "{tagSearch}"
              </div>
            )}
          </div>

          {/* Content type */}
          <div>
            <label className="block text-[12px] text-[rgba(255,255,255,0.5)] mb-2">Content</label>
            <div className="flex gap-2">
              {[['all', 'Everything'], ['photos', 'Photos only'], ['videos', 'Videos only']].map(([val, label]) => (
                <button key={val} onMouseDown={() => setContentType(val)}
                        className="flex-1 py-1.5 rounded-[7px] text-[12px] cursor-pointer transition-all"
                        style={{
                          background: contentType === val ? 'rgba(127,119,221,0.25)' : 'rgba(255,255,255,0.05)',
                          color: contentType === val ? '#CECBF6' : 'rgba(255,255,255,0.45)',
                          border: `0.5px solid ${contentType === val ? 'rgba(127,119,221,0.5)' : 'rgba(255,255,255,0.08)'}`,
                        }}>
                  {label}
                </button>
              ))}
            </div>
          </div>

        </div>

        {/* Footer */}
        <div className="px-5 pb-5 pt-3 flex gap-3 flex-shrink-0"
             style={{ borderTop: '0.5px solid rgba(255,255,255,0.06)' }}>
          <button onMouseDown={onClose}
                  className="flex-1 py-2.5 rounded-[10px] text-[13px] cursor-pointer"
                  style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.5)' }}>
            Cancel
          </button>
          <button onMouseDown={handleGenerate} disabled={busy}
                  className="flex-1 py-2.5 rounded-[10px] text-[13px] font-medium cursor-pointer disabled:opacity-50"
                  style={{ background: 'rgba(127,119,221,0.3)', color: '#CECBF6', border: '0.5px solid rgba(127,119,221,0.5)' }}>
            {busy ? 'Generating…' : `Generate ${count} items`}
          </button>
        </div>

      </div>
    </div>
  )
}

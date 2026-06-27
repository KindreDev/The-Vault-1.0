import React, { useState, useRef, useEffect, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { X, Plus, Tag, UserPlus, MoveRight } from 'lucide-react'
import { imagesApi, creatorsApi, galleriesApi } from '../lib/api'
import { useAllCreators } from '../hooks/useAllCreators'
import toast from 'react-hot-toast'

const TYPE_COLORS = {
  cosplayer: '#9FE1CB', ethot: '#ED93B1', artist: '#CECBF6',
  character: '#FAC775', actress: '#ED93B1', custom: '#D3D1C7',
}

// ── Tag management ─────────────────────────────────────────────────────────────
export function TagPanel({ imageId, tags, onTagsChanged }) {
  const [newTag, setNewTag] = useState('')
  const qc = useQueryClient()

  const addMutation = useMutation({
    mutationFn: (name) => imagesApi.addTag(imageId, name.toLowerCase().trim()),
    onSuccess: (_, name) => {
      onTagsChanged(prev => [...prev, { id: Date.now(), name: name.toLowerCase().trim(), source: 'manual' }])
      setNewTag('')
      qc.invalidateQueries({ queryKey: ['images-list'] })
      qc.invalidateQueries({ queryKey: ['gallery-images'] })
    }
  })

  const removeMutation = useMutation({
    mutationFn: (name) => imagesApi.removeTag(imageId, name),
    onSuccess: (_, name) => {
      onTagsChanged(prev => prev.filter(t => t.name !== name))
      qc.invalidateQueries({ queryKey: ['images-list'] })
      qc.invalidateQueries({ queryKey: ['gallery-images'] })
    }
  })

  const submit = () => { const t = newTag.trim(); if (t) addMutation.mutate(t) }

  return (
    <div className="p-3" style={{ borderBottom: '0.5px solid rgba(255,255,255,0.07)' }}>
      <div className="text-[10px] text-[rgba(255,255,255,0.3)] uppercase tracking-widest mb-2 flex items-center gap-1">
        <Tag size={9} /> Tags
      </div>
      <div className="flex flex-wrap gap-1 mb-2">
        {tags.map(t => (
          <span key={t.id ?? t.name} className="flex items-center gap-0.5 text-[9px] pl-1.5 pr-1 py-0.5 rounded-full"
                style={{ background: t.source === 'ai' ? 'rgba(127,119,221,0.15)' : 'rgba(255,255,255,0.05)',
                         color: t.source === 'ai' ? '#AFA9EC' : 'rgba(255,255,255,0.5)',
                         border: '0.5px solid rgba(255,255,255,0.08)' }}>
            {t.name}
            <button type="button" onMouseDown={() => removeMutation.mutate(t.name)}
                    className="cursor-pointer text-[rgba(255,255,255,0.3)] hover:text-white ml-0.5">
              <X size={8} />
            </button>
          </span>
        ))}
        {tags.length === 0 && <div className="text-[10px] text-[rgba(255,255,255,0.2)]">No tags</div>}
      </div>
      <div className="flex gap-1">
        <input value={newTag} onChange={e => setNewTag(e.target.value)}
               onKeyDown={e => e.key === 'Enter' && submit()}
               placeholder="Add tag…"
               className="flex-1 px-2 py-1 rounded-[6px] text-[10px] outline-none"
               style={{ background: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.7)',
                        border: '0.5px solid rgba(255,255,255,0.1)' }} />
        <button type="button" onMouseDown={submit}
                className="px-2 py-1 rounded-[6px] text-[10px] cursor-pointer"
                style={{ background: 'rgba(127,119,221,0.2)', color: '#CECBF6', border: '0.5px solid rgba(127,119,221,0.3)' }}>
          <Plus size={10} />
        </button>
      </div>
    </div>
  )
}

// ── Creator assignment (dual-level: file override OR gallery) ─────────────────
//
// Props:
//   imageId              — current image id
//   galleryId            — parent gallery id
//   creators             — effective creator list (image-level if hasImageCreators, else gallery-level)
//   hasImageCreators     — true = creators list is the image's own; false = inherited from gallery
//   onCreatorsChanged    — setter for the local creators array
//   onHasImageCreatorsChanged — setter for the hasImageCreators flag
export function CreatorPanel({ imageId, galleryId, creators, hasImageCreators, fileCreatorIds, galleryCreatorIds, onCreatorsChanged, onHasImageCreatorsChanged, onFileCreatorIdsChanged }) {
  const [addOpen, setAddOpen] = useState(false)
  const [search, setSearch]   = useState('')
  const wrapperRef = useRef(null)
  const navigate   = useNavigate()
  const qc         = useQueryClient()

  const fileCrIds = fileCreatorIds ?? []
  const galCrIds  = galleryCreatorIds ?? []

  const { data: allCreators } = useAllCreators()

  const filtered = useMemo(() => {
    if (!allCreators) return []
    const ids = new Set(creators.map(c => c.id))
    return allCreators.filter(c => !ids.has(c.id) && c.name.toLowerCase().includes(search.toLowerCase()))
  }, [allCreators, creators, search])

  useEffect(() => {
    const h = (e) => { if (wrapperRef.current && !wrapperRef.current.contains(e.target)) { setAddOpen(false); setSearch('') } }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['gallery-images'] })
    qc.invalidateQueries({ queryKey: ['galleries'] })
  }

  // Add creator to this file (additive — merges with gallery creators)
  const addFileMutation = useMutation({
    mutationFn: (creatorId) => imagesApi.addCreator(imageId, creatorId),
    onSuccess: (_, creatorId) => {
      const c = allCreators?.find(x => x.id === creatorId)
      if (c) {
        onCreatorsChanged(prev => prev.some(x => x.id === c.id) ? prev : [...prev, c])
        onFileCreatorIdsChanged(prev => prev.includes(creatorId) ? prev : [...prev, creatorId])
        onHasImageCreatorsChanged(true)
        toast.success(`${c.name} assigned to this file`)
      }
      setAddOpen(false); setSearch('')
      invalidate()
    },
    onError: (err) => toast.error(`Failed: ${err.response?.data?.detail || err.message}`)
  })

  // Remove creator from file-level assignment
  const removeFileMutation = useMutation({
    mutationFn: (creatorId) => imagesApi.removeCreator(imageId, creatorId),
    onSuccess: (_, creatorId) => {
      const newFileIds = fileCrIds.filter(id => id !== creatorId)
      onFileCreatorIdsChanged(newFileIds)
      if (newFileIds.length === 0) onHasImageCreatorsChanged(false)
      // If creator is also gallery-inherited, keep them in the merged list (just no longer file-tagged)
      // Otherwise remove them from the display list entirely
      if (!galCrIds.includes(creatorId)) {
        onCreatorsChanged(prev => prev.filter(c => c.id !== creatorId))
      }
      invalidate()
    },
  })

  // Clear ALL file-level assignments on this image
  const clearFileMutation = useMutation({
    mutationFn: () => imagesApi.clearCreators(imageId),
    onSuccess: () => {
      onHasImageCreatorsChanged(false)
      onFileCreatorIdsChanged([])
      qc.invalidateQueries({ queryKey: ['gallery-images'] })
      toast.success('File assignments cleared')
      invalidate()
    },
  })

  if (!galleryId) return null

  const isFileLevelCreator = (c) => fileCrIds.includes(c.id)
  const nonChars = creators.filter(c => c.creator_type !== 'character')
  const chars    = creators.filter(c => c.creator_type === 'character')

  const CreatorChip = ({ c }) => (
    <div className="flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-full text-[10px]"
         style={{ background: 'rgba(255,255,255,0.06)', border: '0.5px solid rgba(255,255,255,0.1)' }}>
      <button type="button" onMouseDown={() => navigate(`/creators/${c.id}`)}
              className="cursor-pointer hover:opacity-70"
              style={{ color: TYPE_COLORS[c.creator_type] || '#D3D1C7' }}>
        {c.name}
      </button>
      {isFileLevelCreator(c) ? (
        <button type="button" onMouseDown={() => removeFileMutation.mutate(c.id)}
                className="cursor-pointer text-[rgba(255,255,255,0.25)] hover:text-white"
                title="Remove file assignment">
          <X size={9} />
        </button>
      ) : (
        <span className="text-[7px] ml-0.5" style={{ color: 'rgba(255,255,255,0.18)' }} title="Inherited from gallery">◆</span>
      )}
    </div>
  )

  return (
    <div ref={wrapperRef} className="p-3" style={{ borderBottom: '0.5px solid rgba(255,255,255,0.07)' }}>

      {/* Header */}
      <div className="text-[10px] text-[rgba(255,255,255,0.3)] uppercase tracking-widest mb-2 flex items-center gap-1">
        <UserPlus size={9} />
        Creators
        {hasImageCreators && (
          <span className="ml-1 px-1 py-0 rounded text-[8px] leading-tight"
                style={{ background: 'rgba(127,119,221,0.2)', color: '#AFA9EC', border: '0.5px solid rgba(127,119,221,0.3)' }}>
            +file
          </span>
        )}
      </div>

      {/* Unified creator list — gallery-inherited (◆) + file-level (×) shown together */}
      <div className="flex flex-wrap gap-1 mb-1.5">
        {nonChars.map(c => <CreatorChip key={c.id} c={c} />)}
        {nonChars.length === 0 && <span className="text-[10px] text-[rgba(255,255,255,0.2)]">None</span>}
      </div>

      {/* Action buttons */}
      <div className="flex gap-1 mb-1">
        <button type="button" onMouseDown={() => { setAddOpen(v => !v); setSearch('') }}
                className="text-[9px] px-1.5 py-0.5 rounded-full cursor-pointer"
                style={{ background: addOpen ? 'rgba(127,119,221,0.25)' : 'rgba(127,119,221,0.12)',
                         color: '#CECBF6', border: '0.5px solid rgba(127,119,221,0.3)' }}>
          + Assign to file
        </button>
        {hasImageCreators && (
          <button type="button" onMouseDown={() => clearFileMutation.mutate()}
                  className="text-[9px] px-1.5 py-0.5 rounded-full cursor-pointer"
                  style={{ background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.35)',
                           border: '0.5px solid rgba(255,255,255,0.08)' }}
                  title="Clear all file-level assignments">
            Clear file
          </button>
        )}
      </div>

      {/* Search dropdown */}
      {addOpen && (
        <div className="mt-1">
          <input autoFocus value={search} onChange={e => setSearch(e.target.value)}
                 placeholder="Search creators…"
                 className="w-full px-2 py-1.5 rounded-[6px] text-[10px] outline-none mb-1"
                 style={{ background: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.8)',
                          border: '0.5px solid rgba(255,255,255,0.1)' }} />
          <div className="rounded-[7px] overflow-hidden" style={{ maxHeight: 140, overflowY: 'auto',
               background: '#1e1e1e', border: '0.5px solid rgba(255,255,255,0.1)' }}>
            {filtered.map(c => (
              <button key={c.id} type="button" onMouseDown={() => addFileMutation.mutate(c.id)}
                      className="w-full text-left px-2 py-1.5 text-[10px] cursor-pointer hover:bg-[rgba(255,255,255,0.05)] flex items-center gap-1.5"
                      style={{ color: 'rgba(255,255,255,0.75)' }}>
                <span className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                      style={{ background: TYPE_COLORS[c.creator_type] || '#D3D1C7' }} />
                {c.name}
              </button>
            ))}
            {filtered.length === 0 && <div className="px-2 py-2 text-[10px] text-[rgba(255,255,255,0.25)] text-center">None found</div>}
          </div>
        </div>
      )}

      {/* Characters section */}
      {chars.length > 0 && (
        <>
          <div className="text-[9px] text-[rgba(255,255,255,0.2)] mt-2.5 mb-1">Also features</div>
          <div className="flex flex-wrap gap-1">
            {chars.map(c => <CreatorChip key={c.id} c={c} />)}
          </div>
        </>
      )}
    </div>
  )
}

// ── Transfer to a different gallery ───────────────────────────────────────────
export function TransferPanel({ imageId, currentGalleryId, onTransferred }) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const wrapperRef = useRef(null)
  const qc = useQueryClient()

  const { data: galleries } = useQuery({
    queryKey: ['galleries-mini'],
    queryFn: () => galleriesApi.list({ limit: 500 }).then(r => r.data),
    enabled: open,
  })

  const filtered = useMemo(() => {
    if (!galleries) return []
    return galleries.filter(g => g.id !== currentGalleryId && g.name.toLowerCase().includes(search.toLowerCase()))
  }, [galleries, currentGalleryId, search])

  useEffect(() => {
    const h = (e) => { if (wrapperRef.current && !wrapperRef.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  const transferMutation = useMutation({
    mutationFn: (galleryId) => imagesApi.transfer(imageId, galleryId),
    onSuccess: (_, galleryId) => {
      qc.invalidateQueries({ queryKey: ['images-list'] })
      qc.invalidateQueries({ queryKey: ['gallery-images'] })
      qc.invalidateQueries({ queryKey: ['galleries'] })
      onTransferred(galleryId)
      setOpen(false)
    },
    onError: () => toast.error('Transfer failed'),
  })

  return (
    <div ref={wrapperRef} className="p-3" style={{ borderBottom: '0.5px solid rgba(255,255,255,0.07)' }}>
      <div className="text-[10px] text-[rgba(255,255,255,0.3)] uppercase tracking-widest mb-2 flex items-center justify-between">
        <span className="flex items-center gap-1"><MoveRight size={9} /> Transfer</span>
        <button type="button" onMouseDown={() => setOpen(o => !o)}
                className="text-[9px] px-1.5 py-0.5 rounded-full cursor-pointer"
                style={{ background: open ? 'rgba(186,117,23,0.2)' : 'rgba(255,255,255,0.06)',
                         color: open ? '#FAC775' : 'rgba(255,255,255,0.4)',
                         border: '0.5px solid rgba(255,255,255,0.08)' }}>
          Move to…
        </button>
      </div>
      {open && (
        <div>
          <input autoFocus value={search} onChange={e => setSearch(e.target.value)}
                 placeholder="Search galleries…"
                 className="w-full px-2 py-1.5 rounded-[6px] text-[10px] outline-none mb-1"
                 style={{ background: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.8)',
                          border: '0.5px solid rgba(255,255,255,0.1)' }} />
          <div className="rounded-[7px] overflow-y-auto" style={{ maxHeight: 140, background: '#1e1e1e', border: '0.5px solid rgba(255,255,255,0.1)' }}>
            {filtered.map(g => (
              <button key={g.id} type="button" onMouseDown={() => transferMutation.mutate(g.id)}
                      className="w-full text-left px-2 py-1.5 text-[10px] cursor-pointer hover:bg-[rgba(255,255,255,0.05)]"
                      style={{ color: 'rgba(255,255,255,0.75)' }}>
                {g.name}
              </button>
            ))}
            {filtered.length === 0 && <div className="px-2 py-2 text-[10px] text-center text-[rgba(255,255,255,0.25)]">No galleries found</div>}
          </div>
        </div>
      )}
    </div>
  )
}

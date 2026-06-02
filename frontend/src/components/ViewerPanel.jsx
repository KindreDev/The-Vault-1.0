import React, { useState, useRef, useEffect, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { X, Plus, Tag, UserPlus, MoveRight } from 'lucide-react'
import { imagesApi, creatorsApi, galleriesApi } from '../lib/api'
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

// ── Creator assignment ─────────────────────────────────────────────────────────
export function CreatorPanel({ galleryId, creators, onCreatorsChanged }) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const wrapperRef = useRef(null)
  const navigate = useNavigate()
  const qc = useQueryClient()

  const { data: allCreators } = useQuery({
    queryKey: ['creators-mini'],
    queryFn: () => creatorsApi.list({ limit: 200 }).then(r => r.data),
  })

  const filtered = useMemo(() => {
    if (!allCreators) return []
    const ids = new Set(creators.map(c => c.id))
    return allCreators.filter(c => !ids.has(c.id) && c.name.toLowerCase().includes(search.toLowerCase()))
  }, [allCreators, creators, search])

  useEffect(() => {
    const h = (e) => { if (wrapperRef.current && !wrapperRef.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  const addMutation = useMutation({
    mutationFn: (creatorId) => galleriesApi.addCreator(galleryId, creatorId),
    onSuccess: (_, creatorId) => {
      const c = allCreators?.find(x => x.id === creatorId)
      if (c) { onCreatorsChanged(prev => [...prev, c]); toast.success(`${c.name} assigned!`) }
      setOpen(false); setSearch('')
      qc.invalidateQueries({ queryKey: ['images-list'] })
      qc.invalidateQueries({ queryKey: ['gallery-images'] })
      qc.invalidateQueries({ queryKey: ['galleries'] })
    },
    onError: (err) => toast.error(`Failed: ${err.response?.data?.detail || err.message}`)
  })

  const removeMutation = useMutation({
    mutationFn: (creatorId) => galleriesApi.removeCreator(galleryId, creatorId),
    onSuccess: (_, creatorId) => {
      onCreatorsChanged(prev => prev.filter(c => c.id !== creatorId))
      qc.invalidateQueries({ queryKey: ['images-list'] })
      qc.invalidateQueries({ queryKey: ['gallery-images'] })
      qc.invalidateQueries({ queryKey: ['galleries'] })
    }
  })

  if (!galleryId) return null

  return (
    <div ref={wrapperRef} className="p-3" style={{ borderBottom: '0.5px solid rgba(255,255,255,0.07)' }}>
      <div className="text-[10px] text-[rgba(255,255,255,0.3)] uppercase tracking-widest mb-2 flex items-center justify-between">
        <span className="flex items-center gap-1"><UserPlus size={9} /> Creators</span>
        <button type="button" onMouseDown={() => setOpen(o => !o)}
                className="text-[9px] px-1.5 py-0.5 rounded-full cursor-pointer"
                style={{ background: 'rgba(127,119,221,0.15)', color: '#CECBF6', border: '0.5px solid rgba(127,119,221,0.3)' }}>
          + Add
        </button>
      </div>
      <div className="flex flex-wrap gap-1 mb-2">
        {creators.filter(c => c.creator_type !== 'character').map(c => (
          <div key={c.id} className="flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-full text-[10px]"
               style={{ background: 'rgba(255,255,255,0.06)', border: '0.5px solid rgba(255,255,255,0.1)' }}>
            <button type="button" onMouseDown={() => navigate(`/creators/${c.id}`)}
                    className="cursor-pointer hover:opacity-70"
                    style={{ color: TYPE_COLORS[c.creator_type] || '#D3D1C7' }}>
              {c.name}
            </button>
            <button type="button" onMouseDown={() => removeMutation.mutate(c.id)}
                    className="cursor-pointer text-[rgba(255,255,255,0.25)] hover:text-white">
              <X size={9} />
            </button>
          </div>
        ))}
        {creators.filter(c => c.creator_type !== 'character').length === 0 && <span className="text-[10px] text-[rgba(255,255,255,0.2)]">No creator assigned</span>}
      </div>

      {creators.filter(c => c.creator_type === 'character').length > 0 && (
        <>
          <div className="text-[10px] text-[rgba(255,255,255,0.3)] uppercase tracking-widest mb-2 mt-3 flex items-center justify-between">
            <span className="flex items-center gap-1">Also appears</span>
          </div>
          <div className="flex flex-wrap gap-1 mb-1">
            {creators.filter(c => c.creator_type === 'character').map(c => (
              <div key={c.id} className="flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-full text-[10px]"
                   style={{ background: 'rgba(255,255,255,0.06)', border: '0.5px solid rgba(255,255,255,0.1)' }}>
                <button type="button" onMouseDown={() => navigate(`/creators/${c.id}`)}
                        className="cursor-pointer hover:opacity-70"
                        style={{ color: TYPE_COLORS[c.creator_type] || '#D3D1C7' }}>
                  {c.name}
                </button>
                <button type="button" onMouseDown={() => removeMutation.mutate(c.id)}
                        className="cursor-pointer text-[rgba(255,255,255,0.25)] hover:text-white">
                  <X size={9} />
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      {open && (
        <div className="mt-1">
          <input autoFocus value={search} onChange={e => setSearch(e.target.value)}
                 placeholder="Search creators…"
                 className="w-full px-2 py-1.5 rounded-[6px] text-[10px] outline-none mb-1"
                 style={{ background: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.8)',
                          border: '0.5px solid rgba(255,255,255,0.1)' }} />
          <div className="rounded-[7px] overflow-hidden" style={{ maxHeight: 150, overflowY: 'auto',
               background: '#1e1e1e', border: '0.5px solid rgba(255,255,255,0.1)' }}>
            {filtered.map(c => (
              <button key={c.id} type="button" onMouseDown={() => addMutation.mutate(c.id)}
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

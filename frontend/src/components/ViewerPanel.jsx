import React, { useState, useRef, useEffect, useMemo } from 'react'
import { LocalizedText, useT } from '../i18n'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { X, Tag, UserPlus, Loader2 } from 'lucide-react'
import { imagesApi, creatorsApi } from '../lib/api'
import { patchCachedCreators } from '../lib/creatorCache'
import { useAllCreators } from '../hooks/useAllCreators'
import TagAutocompleteInput from './TagAutocompleteInput'
import toast from 'react-hot-toast'

const TYPE_COLORS = {
  cosplayer: '#9FE1CB', ethot: '#ED93B1', artist: '#CECBF6',
  character: '#FAC775', actress: '#ED93B1', custom: '#D3D1C7',
}
const CREATOR_TYPES = ['cosplayer', 'ethot', 'artist', 'character', 'actress', 'custom']

/**
 * Turn an axios error into something a human can read.
 *
 * FastAPI returns 422 validation errors as an ARRAY of objects, so the obvious
 * `${err.response.data.detail}` rendered the useless "Failed: [object Object]"
 * users were reporting — the actual problem (a malformed request) was never
 * visible to anyone.
 */
function errText(err) {
  const detail = err?.response?.data?.detail
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) {
    return detail.map(d => d?.msg || JSON.stringify(d)).join(', ')
  }
  if (detail) return JSON.stringify(detail)
  return err?.message || 'Unknown error'
}

// ── Tag management ─────────────────────────────────────────────────────────────
export function TagPanel({ imageId, tags, onTagsChanged }) {
  const qc = useQueryClient()

  const addMutation = useMutation({
    mutationFn: (name) => imagesApi.addTag(imageId, name.toLowerCase().trim()),
    onSuccess: (_, name) => {
      onTagsChanged(prev => [...prev, { id: Date.now(), name: name.toLowerCase().trim(), source: 'manual' }])
      qc.invalidateQueries({ queryKey: ['images-list'] })
      qc.invalidateQueries({ queryKey: ['gallery-images'] })
      qc.invalidateQueries({ queryKey: ['tags'] })
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

  return (
    <div className="p-3" style={{ borderBottom: '0.5px solid rgba(255,255,255,0.07)' }}>
      <div className="text-[16px] text-[rgba(255,255,255,0.3)] uppercase tracking-widest mb-2 flex items-center gap-1">
        <Tag size={16} /><LocalizedText text={"Tags"} before=" " after=" " /></div>
      <div className="flex flex-wrap gap-1 mb-2">
        {tags.map(t => (
          <span key={t.id ?? t.name} className="flex items-center gap-0.5 text-[16px] pl-1.5 pr-1 py-0.5 rounded-full"
                style={{ background: t.source === 'ai' ? 'color-mix(in srgb, var(--c-accent) 15%, transparent)' : 'rgba(255,255,255,0.05)',
                         color: t.source === 'ai' ? '#AFA9EC' : 'rgba(255,255,255,0.5)',
                         border: '0.5px solid rgba(255,255,255,0.08)' }}>
            {t.name}
            <button type="button" onMouseDown={() => removeMutation.mutate(t.name)}
                    className="cursor-pointer text-[rgba(255,255,255,0.3)] hover:text-white ml-0.5">
              <X size={8} />
            </button>
          </span>
        ))}
        {tags.length === 0 && <div className="text-[16px] text-[rgba(255,255,255,0.2)]"><LocalizedText text={"No tags"} /></div>}
      </div>
      <TagAutocompleteInput
        size="sm"
        exclude={tags.map(t => t.name)}
        onAdd={(name) => addMutation.mutate(name)}
      />
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
export function CreatorPanel({ imageId, galleryId, creators, hasImageCreators, fileCreatorIds, galleryCreatorIds, onCreatorsChanged, onHasImageCreatorsChanged, onFileCreatorIdsChanged, allowCreate = false }) {
  const [addOpen, setAddOpen] = useState(false)
  const [search, setSearch]   = useState('')
  const [creating, setCreating] = useState(false)
  const wrapperRef = useRef(null)
  const navigate   = useNavigate()
  const qc         = useQueryClient()
  const t           = useT()

  const fileCrIds = fileCreatorIds ?? []
  const galCrIds  = galleryCreatorIds ?? []

  // The optional callbacks let a caller wire up only what it tracks. Without
  // these no-op fallbacks a partially-wired call site throws mid-mutation and
  // the assignment silently half-applies.
  const setCreators        = onCreatorsChanged          ?? (() => {})
  const setFileIds         = onFileCreatorIdsChanged    ?? (() => {})
  const setHasFileCreators = onHasImageCreatorsChanged  ?? (() => {})

  const { data: allCreators } = useAllCreators()

  const filtered = useMemo(() => {
    if (!allCreators) return []
    const ids = new Set(creators.map(c => c.id))
    return allCreators.filter(c => !ids.has(c.id) && c.name.toLowerCase().includes(search.toLowerCase()))
  }, [allCreators, creators, search])

  const canCreate = allowCreate
    && search.trim().length >= 2
    && !allCreators.some(c => c.name?.toLowerCase() === search.trim().toLowerCase())

  useEffect(() => {
    const h = (e) => { if (wrapperRef.current && !wrapperRef.current.contains(e.target)) { setAddOpen(false); setSearch('') } }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  // Refresh what the viewer was opened from. 'images-list' is deliberately
  // included: the Photos and Videos tabs read from it, so without it a creator
  // assigned in the viewer only appeared in the grid after a manual refresh.
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['gallery-images'] })
    qc.invalidateQueries({ queryKey: ['images-list'] })
    qc.invalidateQueries({ queryKey: ['galleries'] })
  }

  // Add creator to this file (additive — merges with gallery creators).
  // The imageId guard is load-bearing: a call site that forgot to pass it sent
  // POST /images/undefined/creators/7, and the 422 that came back surfaced as
  // "Failed: [object Object]" with the assignment silently never happening.
  const addFileMutation = useMutation({
    mutationFn: (creatorId) => {
      if (!imageId) return Promise.reject(new Error('No file selected'))
      return imagesApi.addCreator(imageId, creatorId)
    },
    onSuccess: (_, creatorId) => {
      const c = allCreators?.find(x => x.id === creatorId)
      if (c) {
        setCreators(prev => prev.some(x => x.id === c.id) ? prev : [...prev, c])
        setFileIds(prev => prev.includes(creatorId) ? prev : [...prev, creatorId])
        setHasFileCreators(true)
        toast.success(t('{name} assigned to this file', { name: c.name }))
        // Patch the grid behind the viewer rather than invalidating it — the
        // list this came from costs about a second to refetch, and we already
        // know precisely what changed.
        patchCachedCreators(qc, [imageId], c)
      }
      setAddOpen(false); setSearch('')
      // GalleryView derives its creator cards from the gallery image rows.
      // Refresh that source after an assignment so file-only creators appear
      // there immediately, not only after a full page reload.
      invalidate()
    },
    onError: (err) => toast.error(t('Failed: {details}', { details: errText(err) }))
  })

  // File curation can create a missing creator without leaving the run. The
  // creator is persisted first, then assigned through the same file-level path
  // as an existing creator so the new relationship is immediately usable.
  const createCreator = async (type) => {
    const name = search.trim()
    if (!canCreate || !imageId || creating) return
    setCreating(true)
    try {
      const r = await creatorsApi.create({ name, creator_type: type })
      const c = r.data
      await imagesApi.addCreator(imageId, c.id)
      qc.setQueryData(['creators-all', 5000], current => {
        const list = Array.isArray(current) ? current : []
        return list.some(item => item.id === c.id) ? list : [...list, c]
      })
      setCreators(prev => prev.some(item => item.id === c.id) ? prev : [...prev, c])
      setFileIds(prev => prev.includes(c.id) ? prev : [...prev, c.id])
      setHasFileCreators(true)
      patchCachedCreators(qc, [imageId], c)
      toast.success(t('Created {name}', { name }))
      setAddOpen(false)
      setSearch('')
      invalidate()
    } catch (err) {
      toast.error(t('Could not create that creator') + `: ${errText(err)}`)
    } finally {
      setCreating(false)
    }
  }

  // Remove creator from file-level assignment
  const removeFileMutation = useMutation({
    mutationFn: (creatorId) => imagesApi.removeCreator(imageId, creatorId),
    onSuccess: (_, creatorId) => {
      const newFileIds = fileCrIds.filter(id => id !== creatorId)
      setFileIds(newFileIds)
      if (newFileIds.length === 0) setHasFileCreators(false)
      // If creator is also gallery-inherited, keep them in the merged list (just no longer file-tagged)
      // Otherwise remove them from the display list entirely
      if (!galCrIds.includes(creatorId)) {
        setCreators(prev => prev.filter(c => c.id !== creatorId))
      }
      invalidate()
    },
    onError: (err) => toast.error(t('Failed: {details}', { details: errText(err) }))
  })

  // Clear ALL file-level assignments on this image
  const clearFileMutation = useMutation({
    mutationFn: () => imagesApi.clearCreators(imageId),
    onSuccess: () => {
      setHasFileCreators(false)
      setFileIds([])
      qc.invalidateQueries({ queryKey: ['gallery-images'] })
      toast.success(t('File assignments cleared'))
      invalidate()
    },
  })

  if (!galleryId) return null

  const isFileLevelCreator = (c) => fileCrIds.includes(c.id)
  const nonChars = creators.filter(c => c.creator_type !== 'character')
  const chars    = creators.filter(c => c.creator_type === 'character')

  const CreatorChip = ({ c }) => (
    <div className="flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-full text-[16px]"
         style={{ background: 'rgba(255,255,255,0.06)', border: '0.5px solid rgba(255,255,255,0.1)' }}>
      <button type="button" onMouseDown={() => navigate(`/creators/${c.id}`)}
              className="cursor-pointer hover:opacity-70"
              style={{ color: TYPE_COLORS[c.creator_type] || '#D3D1C7' }}>
        {c.name}
      </button>
      {isFileLevelCreator(c) ? (
        <button type="button" onMouseDown={() => removeFileMutation.mutate(c.id)}
                className="cursor-pointer text-[rgba(255,255,255,0.25)] hover:text-white"
                title={t("Remove file assignment")}>
          <X size={9} />
        </button>
      ) : (
        <span className="text-[7px] ml-0.5" style={{ color: 'rgba(255,255,255,0.18)' }} title={t("Inherited from gallery")}>◆</span>
      )}
    </div>
  )

  return (
    <div ref={wrapperRef} className="p-3" style={{ borderBottom: '0.5px solid rgba(255,255,255,0.07)' }}>

      {/* Header */}
      <div className="text-[16px] text-[rgba(255,255,255,0.3)] uppercase tracking-widest mb-2 flex items-center gap-1">
        <UserPlus size={16} /><LocalizedText text={"Creators"} before=" " after=" " /></div>

      {/* Unified creator list — gallery-inherited (◆) + file-level (×) shown together */}
      <div className="flex flex-wrap gap-1 mb-1.5">
        {nonChars.map(c => <CreatorChip key={c.id} c={c} />)}
        {nonChars.length === 0 && <span className="text-[16px] text-[rgba(255,255,255,0.2)]"><LocalizedText text={"None"} /></span>}
      </div>

      {/* Action buttons */}
      <div className="flex gap-1 mb-1">
        <button type="button" onMouseDown={() => { setAddOpen(v => !v); setSearch('') }}
                className="inline-flex items-center gap-1 text-[16px] px-1 py-0.5 rounded-full cursor-pointer whitespace-nowrap"
                style={{ background: addOpen ? 'color-mix(in srgb, var(--c-accent) 25%, transparent)' : 'color-mix(in srgb, var(--c-accent) 12%, transparent)',
                         color: 'var(--c-accent-text)', border: '0.5px solid color-mix(in srgb, var(--c-accent) 30%, transparent)' }}>
          <UserPlus size={15} /><LocalizedText text={"Assign creator"} before=" " after=" " /></button>
        {hasImageCreators && (
          <button type="button" onMouseDown={() => clearFileMutation.mutate()}
                  className="inline-flex items-center gap-1 text-[16px] px-1 py-0.5 rounded-full cursor-pointer whitespace-nowrap"
                  style={{ background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.35)',
                           border: '0.5px solid rgba(255,255,255,0.08)' }}
                  title={t("Clear all file-level assignments")}>
            <X size={15} /><LocalizedText text={"Clear"} before=" " after=" " /></button>
        )}
      </div>

      {/* Search dropdown */}
      {addOpen && (
        <div className="mt-1">
          <input autoFocus value={search} onChange={e => setSearch(e.target.value)}
                 placeholder={t("Search creators…")}
                 className="w-full px-2 py-1.5 rounded-[6px] text-[16px] outline-none mb-1"
                 style={{ background: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.8)',
                          border: '0.5px solid rgba(255,255,255,0.1)' }} />
          <div className="rounded-[7px] overflow-hidden" style={{ maxHeight: 140, overflowY: 'auto',
               background: 'var(--c-card, #1e1e1e)', border: '0.5px solid rgba(255,255,255,0.1)' }}>
            {filtered.map(c => (
              <button key={c.id} type="button" onMouseDown={() => addFileMutation.mutate(c.id)}
                      className="w-full text-left px-2 py-1.5 text-[16px] cursor-pointer hover:bg-[rgba(255,255,255,0.05)] flex items-center gap-1.5"
                      style={{ color: 'rgba(255,255,255,0.75)' }}>
                <span className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                      style={{ background: TYPE_COLORS[c.creator_type] || '#D3D1C7' }} />
                {c.name}
              </button>
            ))}
            {filtered.length === 0 && !canCreate && <div className="px-2 py-2 text-[16px] text-[rgba(255,255,255,0.25)] text-center"><LocalizedText text={"None found"} /></div>}
            {canCreate && (
              <div className="px-2 py-2.5 flex flex-col gap-2"
                   style={{ borderTop: filtered.length ? '0.5px solid rgba(255,255,255,0.09)' : 'none', background: 'color-mix(in srgb, var(--c-green) 7%, transparent)' }}>
                <div className="flex items-center gap-2 text-[16px]" style={{ color: 'var(--c-green-text)' }}>
                  {creating ? <Loader2 size={13} className="animate-spin" /> : <UserPlus size={13} />}
                  {t('Create')} “{search.trim()}” {t('as')}…
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {CREATOR_TYPES.map(type => (
                    <button key={type} type="button" onMouseDown={() => createCreator(type)} disabled={creating}
                            className="px-2 py-1 rounded-full cursor-pointer disabled:opacity-40 text-[16px]"
                            style={{ background: 'color-mix(in srgb, var(--c-green) 16%, transparent)', color: 'var(--c-green-text)', border: '0.5px solid color-mix(in srgb, var(--c-green) 32%, transparent)' }}>
                      {t(type)}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Characters section */}
      {chars.length > 0 && (
        <>
          <div className="text-[16px] text-[rgba(255,255,255,0.2)] mt-2.5 mb-1"><LocalizedText text={"Also features"} /></div>
          <div className="flex flex-wrap gap-1">
            {chars.map(c => <CreatorChip key={c.id} c={c} />)}
          </div>
        </>
      )}
    </div>
  )
}

// The viewer used to carry a "Move to…" panel here. It reassigned the file's
// gallery without moving the file, which the scanner then undid — destroying the
// file's rating, cum count, views and tags along the way. Moving files lives in
// the right-click Relocate action, which moves them on disk.

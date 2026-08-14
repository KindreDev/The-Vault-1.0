import React, { useState, useRef, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Copy, X, Plus } from 'lucide-react'
import { galleriesApi } from '../lib/api'
import { useT } from '../i18n'
import toast from 'react-hot-toast'

/**
 * Copy files into a mix gallery.
 *
 * A copy adds a reference only — the file stays where it is and keeps its
 * original gallery. Targets are restricted to **mix galleries**: a normal
 * gallery mirrors a folder on disk, and the scanner prunes rows whose file
 * isn't in that folder, so a copied reference there would vanish on rescan.
 * Mix galleries are virtual and explicitly skipped by that prune.
 *
 * This modal used to do moves as well, by rewriting each file's gallery_id.
 * That never touched the disk, so the scanner pruned the row (the file
 * disappeared from the app) and a later scan re-imported it into its original
 * gallery with its rating, cum count, views, favourite and tags all reset.
 * Moving files is RelocateModal's job now — it moves them for real.
 *
 * Props:
 *   images            array of image objects to copy
 *   currentGalleryId  excluded from the target list (optional)
 *   onClose           () => void
 */
export default function GalleryTransferModal({
  images,
  currentGalleryId,
  onClose,
}) {
  const t = useT()
  const [search, setSearch]           = useState('')
  const [targetGallery, setTarget]    = useState(null)
  const [working, setWorking]         = useState(false)
  const [creatingNew, setCreatingNew] = useState(false)
  const inputRef = useRef(null)
  const qc = useQueryClient()

  useEffect(() => { inputRef.current?.focus() }, [])

  // The mix-gallery pool is tiny by nature, so it's fetched once and filtered
  // in the browser rather than round-tripping on every keystroke.
  const { data: allGalleries } = useQuery({
    queryKey: ['galleries-transfer-targets'],
    queryFn: () => galleriesApi.list({
      limit: 500, sort_by: 'date_added', is_mix: true,
    }).then(r => r.data),
    staleTime: 30000,
  })

  const candidates = useMemo(() => {
    const list = Array.isArray(allGalleries) ? allGalleries : (allGalleries?.items ?? [])
    return list.filter(g => g.id !== currentGalleryId)
  }, [allGalleries, currentGalleryId])

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim()
    // Show the whole pool up front rather than making the user guess the names
    // of playlists they just made.
    if (!q) return candidates.slice(0, 40)
    return candidates.filter(g => g.name.toLowerCase().includes(q)).slice(0, 40)
  }, [candidates, search])

  const accent = { fg: '#9FE1CB', bg: 'color-mix(in srgb, var(--c-green) 15%, transparent)', bd: 'color-mix(in srgb, var(--c-green) 40%, transparent)' }

  const handleCreateMix = async () => {
    const name = search.trim()
    if (!name || creatingNew) return
    setCreatingNew(true)
    try {
      const { data } = await galleriesApi.createMix({ name })
      qc.invalidateQueries({ queryKey: ['galleries-transfer-targets'] })
      setTarget(data)
      setSearch(data.name)
    } catch {
      toast.error(t('Could not create playlist gallery'))
    }
    setCreatingNew(false)
  }

  const run = async () => {
    if (!targetGallery || working) return
    setWorking(true)
    try {
      const { data } = await galleriesApi.addMixImages(targetGallery.id, images.map(i => i.id))
      qc.invalidateQueries({ queryKey: ['galleries'] })
      qc.invalidateQueries({ queryKey: ['galleries-transfer-targets'] })
      if (data.added === 0) {
        toast(t('Already in that gallery'), { icon: 'ℹ️' })
      } else {
        const skipped = data.skipped ? ` (${data.skipped} already there)` : ''
        toast.success(`${data.added} → "${targetGallery.name}"${skipped}`)
      }
      onClose()
    } catch (err) {
      toast.error(err?.response?.data?.detail || t('Copy failed'))
      setWorking(false)
    }
  }

  const noun = images.length === 1 ? t('image') : `${images.length} images`

  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4"
         style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)' }}
         onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="rounded-[14px] w-full max-w-sm flex flex-col overflow-hidden"
           style={{ background: '#1a1a1a', border: '1px solid rgba(255,255,255,0.12)', maxHeight: '80vh' }}>

        <div className="flex items-center justify-between px-5 py-4 border-b border-[rgba(255,255,255,0.07)]">
          <div className="flex items-center gap-2">
            <Copy size={16} style={{ color: accent.fg }} />
            <span style={{ fontSize: 15, fontWeight: 600, color: 'rgba(255,255,255,0.9)' }}>
              {t('Copy')} {noun} {t('to gallery')}
            </span>
          </div>
          <button onClick={onClose} className="cursor-pointer" style={{ color: 'rgba(255,255,255,0.4)' }}>
            <X size={16} />
          </button>
        </div>

        <div className="px-5 py-4 flex flex-col gap-3">
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', lineHeight: 1.5 }}>
            {t('Copies a reference only — the file stays where it is. Copy targets are mix galleries, which aren\'t tied to a folder on disk.')}
          </div>

          <div>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginBottom: 6 }}>
              {t('Search by gallery name')}
            </div>
            <input
              ref={inputRef}
              value={search}
              onChange={e => { setSearch(e.target.value); setTarget(null) }}
              onKeyDown={e => { if (e.key === 'Escape') onClose() }}
              placeholder={t('Search or name a new one…')}
              className="w-full rounded-[8px] px-3 py-2 outline-none"
              style={{ fontSize: 13, background: 'rgba(255,255,255,0.06)', border: '0.5px solid rgba(255,255,255,0.14)', color: 'rgba(255,255,255,0.9)' }}
            />
          </div>

          {targetGallery ? (
            <div className="flex items-center justify-between px-3 py-2 rounded-[8px]"
                 style={{ background: accent.bg, border: `0.5px solid ${accent.bd}` }}>
              <div>
                <div style={{ fontSize: 13, color: accent.fg, fontWeight: 600 }}>{targetGallery.name}</div>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', marginTop: 1 }}>
                  {targetGallery.image_count ?? 0} {t('images currently')}
                </div>
              </div>
              <button onClick={() => { setTarget(null); setSearch('') }}
                      className="cursor-pointer" style={{ color: 'rgba(255,255,255,0.3)' }}>
                <X size={12} />
              </button>
            </div>
          ) : (
            filtered.length > 0 && (
              <div className="rounded-[8px] overflow-hidden overflow-y-auto"
                   style={{ background: '#161620', border: '0.5px solid rgba(255,255,255,0.1)', maxHeight: 200 }}>
                {filtered.map(g => (
                  <button key={g.id} onClick={() => { setTarget(g); setSearch(g.name) }}
                          className="w-full text-left px-3 py-2 flex items-center justify-between cursor-pointer transition-colors"
                          style={{ fontSize: 13, color: 'rgba(255,255,255,0.75)', borderBottom: '0.5px solid rgba(255,255,255,0.05)' }}
                          onMouseEnter={e => e.currentTarget.style.background = accent.bg}
                          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                    <span>{g.name}</span>
                    <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)' }}>{g.image_count ?? 0} {t('imgs')}</span>
                  </button>
                ))}
              </div>
            )
          )}

          {/* A fresh mix gallery can be minted inline, so a new playlist doesn't
              require a detour to another screen first. */}
          {!targetGallery && search.trim() &&
           !candidates.some(g => g.name.toLowerCase() === search.trim().toLowerCase()) && (
            <button onClick={handleCreateMix} disabled={creatingNew}
                    className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-[8px] cursor-pointer disabled:opacity-40"
                    style={{ fontSize: 13, background: 'color-mix(in srgb, var(--c-green) 12%, transparent)', color: 'var(--c-green-text)', border: '0.5px solid color-mix(in srgb, var(--c-green) 30%, transparent)' }}>
              <Plus size={13} /> {creatingNew ? t('Creating…') : `${t('New playlist gallery')} “${search.trim()}”`}
            </button>
          )}

          {candidates.length === 0 && !search.trim() && (
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.25)', textAlign: 'center', padding: '8px 0' }}>
              {t('No mix galleries yet — type a name above to make one.')}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 px-5 py-4 border-t border-[rgba(255,255,255,0.07)]">
          <button onClick={onClose} disabled={working}
                  className="px-4 py-2 rounded-[8px] text-[13px] cursor-pointer disabled:opacity-40"
                  style={{ color: 'rgba(255,255,255,0.45)', border: '0.5px solid rgba(255,255,255,0.1)' }}>
            {t('Cancel')}
          </button>
          <button onClick={run} disabled={!targetGallery || working}
                  className="px-4 py-2 rounded-[8px] text-[13px] cursor-pointer disabled:opacity-40 flex items-center gap-2"
                  style={{ background: accent.bg, color: accent.fg, border: `0.5px solid ${accent.bd}` }}>
            {working
              ? <><span className="animate-spin inline-block">⟳</span> {t('Copying…')}</>
              : <><Copy size={13} /> {t('Copy')} {noun}</>
            }
          </button>
        </div>
      </div>
    </div>
  , document.body)
}

/**
 * <RelocateModal /> — move galleries or loose files somewhere else on the drive.
 *
 * This is the only place in the app that moves the user's actual files, so it
 * works in two beats: pick a destination, then *check* it. The check is a dry
 * run on the server that reports the exact target path per gallery and which
 * names already exist there. Nothing moves until the confirm button, and name
 * clashes have to be answered (merge / rename / skip) before it unlocks.
 *
 * The recommended destination comes from the gallery's main creator — the first
 * one linked. A gallery sitting outside its creator's folder is the case worth
 * fixing, so those are called out at the top.
 *
 * mode='galleries' — moves whole folders (folder = gallery, so the folder moves
 *   intact and stays one gallery).
 * mode='images' — loose files land inside an existing gallery's folder rather
 *   than loose in a creator root, so every moved file still has an owner.
 */
import React, { useState, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import {
  FolderSymlink, X, Search, HardDrive, AlertTriangle, Check,
  ArrowRight, Loader2, FolderOpen,
} from 'lucide-react'
import { relocateApi, galleriesApi } from '../lib/api'
import { useT } from '../i18n'
import toast from 'react-hot-toast'

const CLASH_OPTIONS = [
  { key: 'rename', label: 'Keep both',  hint: 'Moves it alongside as “Name (2)”' },
  { key: 'merge',  label: 'Merge',      hint: 'Pours the files into the folder already there' },
  { key: 'skip',   label: 'Leave it',   hint: 'Skips any gallery whose name is taken' },
]

export default function RelocateModal({
  mode = 'galleries',
  galleries = [],
  images = [],
  onClose,
  onDone,
}) {
  const t = useT()
  const qc = useQueryClient()
  const isGalleries = mode === 'galleries'

  const [dest, setDest]         = useState(null)   // chosen folder path
  const [search, setSearch]     = useState('')
  const [plan, setPlan]         = useState(null)
  const [strategy, setStrategy] = useState('rename')
  const [busy, setBusy]         = useState(false)

  const galleryIds = useMemo(() => galleries.map(g => g.id), [galleries])
  const imageIds   = useMemo(() => images.map(i => i.id), [images])

  // ── Galleries: where they are now and where they could go ──────────────────
  const { data: suggestion, isLoading: loadingSuggestion } = useQuery({
    queryKey: ['relocate-suggest', galleryIds],
    queryFn: () => relocateApi.suggest(galleryIds).then(r => r.data),
    enabled: isGalleries && galleryIds.length > 0,
  })

  // ── Images: the galleries they could land in ───────────────────────────────
  // Searched server-side. Filtering a fetched page in the browser would silently
  // hide every gallery sorting past the window — on a 21,000-gallery library the
  // slice doesn't even reach "A".
  const { data: galleryList } = useQuery({
    queryKey: ['relocate-targets', search],
    queryFn: () => galleriesApi.list({
      search: search || undefined, limit: 40, sort_by: 'name', is_mix: false,
    }).then(r => r.data),
    enabled: !isGalleries,
  })
  // A file can't land in a mix gallery (no folder of its own) or in the gallery
  // it's already in.
  const currentGalleryIds = useMemo(
    () => new Set(images.map(i => i.gallery_id).filter(Boolean)),
    [images]
  )
  const targets = useMemo(() => {
    const list = galleryList?.items ?? galleryList ?? []
    return list.filter(g => !g.is_mix && !(currentGalleryIds.size === 1 && currentGalleryIds.has(g.id)))
  }, [galleryList, currentGalleryIds])

  const folders = useMemo(() => {
    const all = suggestion?.creator_folders ?? []
    if (!search) return all
    const q = search.toLowerCase()
    return all.filter(c => c.name.toLowerCase().includes(q) || (c.folder || '').toLowerCase().includes(q))
  }, [suggestion, search])

  async function pickCustom() {
    try {
      const { data } = await galleriesApi.pickFolder()
      setDest(data.path)
      setPlan(null)
    } catch (e) {
      if (e?.response?.status !== 400) toast.error(t('Could not open the folder picker'))
    }
  }

  async function runCheck() {
    setBusy(true)
    try {
      const { data } = await relocateApi.plan(galleryIds, dest)
      setPlan(data)
    } catch (e) {
      toast.error(e?.response?.data?.detail || t('Could not check that destination'))
    } finally {
      setBusy(false)
    }
  }

  async function confirmMove() {
    setBusy(true)
    try {
      if (isGalleries) {
        const { data } = await relocateApi.moveGalleries(galleryIds, dest, strategy)
        const parts = []
        if (data.moved)   parts.push(t('{n} moved').replace('{n}', data.moved))
        if (data.merged)  parts.push(t('{n} merged').replace('{n}', data.merged))
        if (data.skipped) parts.push(t('{n} left alone').replace('{n}', data.skipped))
        toast.success(parts.join(' · ') || t('Nothing to move'))
        if (data.errors?.length) {
          toast.error(t('{n} could not be moved').replace('{n}', data.errors.length))
        }
      } else {
        const { data } = await relocateApi.moveImages(imageIds, dest)
        toast.success(
          t('{n} moved into {name}')
            .replace('{n}', data.moved)
            .replace('{name}', data.target_gallery?.name ?? '')
        )
        if (data.errors?.length) {
          toast.error(t('{n} could not be moved').replace('{n}', data.errors.length))
        }
      }
      qc.invalidateQueries({ queryKey: ['galleries'] })
      qc.invalidateQueries({ queryKey: ['images'] })
      onDone?.()
      onClose()
    } catch (e) {
      toast.error(e?.response?.data?.detail || t('The move failed'))
    } finally {
      setBusy(false)
    }
  }

  const misplaced = suggestion?.misplaced_count ?? 0
  const clashes   = plan?.clashes ?? 0
  const canMove   = isGalleries ? (dest && plan) : !!dest

  return createPortal(
    <div className="fixed inset-0 z-[10000] flex items-center justify-center p-6"
         style={{ background: 'rgba(0,0,0,0.62)', backdropFilter: 'blur(6px)' }}
         onMouseDown={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.97, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
        onMouseDown={e => e.stopPropagation()}
        className="flex flex-col rounded-[16px] overflow-hidden"
        style={{
          width: 620, maxHeight: '82vh',
          background: 'rgba(24,24,27,0.98)',
          border: '0.5px solid rgba(255,255,255,0.13)',
          boxShadow: '0 24px 80px rgba(0,0,0,0.6)',
        }}>

        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4"
             style={{ borderBottom: '0.5px solid rgba(255,255,255,0.08)' }}>
          <FolderSymlink size={19} style={{ color: 'var(--accent)' }} />
          <div className="flex-1 min-w-0">
            <div style={{ fontSize: 17, fontWeight: 600, color: 'rgba(255,255,255,0.88)' }}>
              {t('Relocate')}
            </div>
            <div style={{ fontSize: 16, color: 'rgba(255,255,255,0.42)' }}>
              {isGalleries
                ? (galleries.length === 1
                    ? t('1 gallery')
                    : t('{n} galleries').replace('{n}', galleries.length))
                : (images.length === 1
                    ? t('1 file')
                    : t('{n} files').replace('{n}', images.length))}
              {' · '}
              {t('moves them on the drive')}
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg cursor-pointer hover:bg-white/[0.07]">
            <X size={17} style={{ color: 'rgba(255,255,255,0.5)' }} />
          </button>
        </div>

        {/* Misplaced callout */}
        {isGalleries && misplaced > 0 && (
          <div className="flex items-start gap-2.5 px-5 py-3"
               style={{ background: 'color-mix(in srgb, var(--c-amber) 12%, transparent)',
                        borderBottom: '0.5px solid rgba(255,255,255,0.06)' }}>
            <AlertTriangle size={16} style={{ color: 'var(--c-amber-text)', flexShrink: 0, marginTop: 2 }} />
            <div style={{ fontSize: 16, color: 'rgba(255,255,255,0.75)' }}>
              {misplaced === 1
                ? t('This gallery is filed outside its creator’s folder.')
                : t('{n} of these are filed outside their creator’s folder.').replace('{n}', misplaced)}
              {suggestion?.recommended && (
                <>
                  {' '}
                  <button
                    onClick={() => { setDest(suggestion.recommended); setPlan(null) }}
                    className="cursor-pointer underline"
                    style={{ color: 'var(--c-amber-text)' }}>
                    {t('Move them home')}
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4" style={{ minHeight: 220 }}>
          {/* Chosen destination */}
          <div className="flex items-center gap-2.5 mb-4 px-3 py-2.5 rounded-[10px]"
               style={{ background: dest ? 'color-mix(in srgb, var(--accent) 12%, transparent)'
                                         : 'rgba(255,255,255,0.04)',
                        border: '0.5px solid rgba(255,255,255,0.09)' }}>
            <HardDrive size={15} style={{ color: dest ? 'var(--accent)' : 'rgba(255,255,255,0.3)', flexShrink: 0 }} />
            <span className="truncate" style={{ fontSize: 16, color: dest ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.35)' }}>
              {isGalleries
                ? (dest || t('Pick where these should go'))
                : (dest ? (targets.find(g => g.id === dest)?.name || t('Gallery #{id}').replace('{id}', dest))
                        : t('Pick the gallery these files should join'))}
            </span>
            {isGalleries && (
              <button onClick={pickCustom}
                      className="ml-auto flex items-center gap-1.5 px-2.5 py-1 rounded-[7px] cursor-pointer flex-shrink-0 hover:bg-white/[0.08]"
                      style={{ fontSize: 16, color: 'rgba(255,255,255,0.6)',
                               border: '0.5px solid rgba(255,255,255,0.12)' }}>
                <FolderOpen size={13} /> {t('Browse…')}
              </button>
            )}
          </div>

          {/* Search */}
          <div className="flex items-center gap-2 mb-3 px-3 py-2 rounded-[9px]"
               style={{ background: 'rgba(255,255,255,0.05)', border: '0.5px solid rgba(255,255,255,0.1)' }}>
            <Search size={14} style={{ color: 'rgba(255,255,255,0.35)' }} />
            <input
              autoFocus
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={isGalleries ? t('Search creator folders…') : t('Search galleries…')}
              className="flex-1 bg-transparent outline-none"
              style={{ fontSize: 16, color: 'rgba(255,255,255,0.85)' }}
            />
          </div>

          {/* Destination list */}
          {loadingSuggestion && (
            <div style={{ fontSize: 16, color: 'rgba(255,255,255,0.3)' }}>{t('Looking things up…')}</div>
          )}

          {isGalleries ? folders.map(c => (
            <button key={c.id}
                    onClick={() => { setDest(c.folder); setPlan(null) }}
                    className="w-full flex items-center gap-3 px-3 py-2 rounded-[8px] text-left cursor-pointer hover:bg-white/[0.05]"
                    style={{ background: dest === c.folder ? 'color-mix(in srgb, var(--accent) 14%, transparent)' : 'transparent' }}>
              <span className="flex-1 min-w-0">
                <span className="block truncate" style={{ fontSize: 16, color: 'rgba(255,255,255,0.82)' }}>{c.name}</span>
                <span className="block truncate" style={{ fontSize: 16, color: 'rgba(255,255,255,0.32)' }}>{c.folder}</span>
              </span>
              {c.folder === suggestion?.recommended && (
                <span className="flex-shrink-0 px-2 py-0.5 rounded-full"
                      style={{ fontSize: 16, color: 'var(--c-amber-text)', background: 'color-mix(in srgb, var(--c-amber) 16%, transparent)' }}>
                  {t('suggested')}
                </span>
              )}
              {dest === c.folder && <Check size={15} style={{ color: 'var(--accent)', flexShrink: 0 }} />}
            </button>
          )) : targets.map(g => (
            <button key={g.id}
                    onClick={() => setDest(g.id)}
                    className="w-full flex items-center gap-3 px-3 py-2 rounded-[8px] text-left cursor-pointer hover:bg-white/[0.05]"
                    style={{ background: dest === g.id ? 'color-mix(in srgb, var(--accent) 14%, transparent)' : 'transparent' }}>
              <span className="flex-1 min-w-0">
                <span className="block truncate" style={{ fontSize: 16, color: 'rgba(255,255,255,0.82)' }}>{g.name}</span>
                <span className="block truncate" style={{ fontSize: 16, color: 'rgba(255,255,255,0.32)' }}>{g.folder_path}</span>
              </span>
              {dest === g.id && <Check size={15} style={{ color: 'var(--accent)', flexShrink: 0 }} />}
            </button>
          ))}

          {/* Dry-run result */}
          {plan && (
            <div className="mt-4 pt-3" style={{ borderTop: '0.5px solid rgba(255,255,255,0.08)' }}>
              <div className="mb-2" style={{ fontSize: 16, color: 'rgba(255,255,255,0.6)' }}>
                {clashes > 0
                  ? t('{n} of these names already exist there.').replace('{n}', clashes)
                  : t('Nothing in the way — every folder can move as-is.')}
              </div>
              {plan.plans.slice(0, 8).map(p => (
                <div key={p.id} className="flex items-center gap-2 py-1" style={{ fontSize: 16 }}>
                  {p.status === 'clash'
                    ? <AlertTriangle size={13} style={{ color: 'var(--c-amber-text)', flexShrink: 0 }} />
                    : <ArrowRight size={13} style={{ color: 'rgba(255,255,255,0.3)', flexShrink: 0 }} />}
                  <span className="truncate" style={{ color: 'rgba(255,255,255,0.7)' }}>{p.name}</span>
                  <span className="truncate ml-auto" style={{ color: 'rgba(255,255,255,0.3)' }}>
                    {p.reason || p.target}
                  </span>
                </div>
              ))}
              {plan.plans.length > 8 && (
                <div style={{ fontSize: 16, color: 'rgba(255,255,255,0.28)' }}>
                  {t('+{n} more').replace('{n}', plan.plans.length - 8)}
                </div>
              )}

              {clashes > 0 && (
                <div className="mt-3">
                  <div className="mb-1.5" style={{ fontSize: 16, color: 'rgba(255,255,255,0.55)' }}>
                    {t('What should happen to those?')}
                  </div>
                  <div className="flex gap-2">
                    {CLASH_OPTIONS.map(o => (
                      <button key={o.key}
                              onClick={() => setStrategy(o.key)}
                              title={t(o.hint)}
                              className="flex-1 px-3 py-2 rounded-[8px] cursor-pointer"
                              style={{
                                fontSize: 16,
                                color: strategy === o.key ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.5)',
                                background: strategy === o.key
                                  ? 'color-mix(in srgb, var(--accent) 20%, transparent)' : 'rgba(255,255,255,0.04)',
                                border: '0.5px solid rgba(255,255,255,0.1)',
                              }}>
                        {t(o.label)}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-2 px-5 py-4"
             style={{ borderTop: '0.5px solid rgba(255,255,255,0.08)' }}>
          <span className="flex-1" style={{ fontSize: 16, color: 'rgba(255,255,255,0.32)' }}>
            {isGalleries && !plan && dest && t('Check it first — nothing moves until you confirm.')}
          </span>
          <button onClick={onClose}
                  className="px-4 py-2 rounded-[9px] cursor-pointer hover:bg-white/[0.06]"
                  style={{ fontSize: 16, color: 'rgba(255,255,255,0.6)' }}>
            {t('Cancel')}
          </button>
          {isGalleries && !plan ? (
            <button onClick={runCheck} disabled={!dest || busy}
                    className="flex items-center gap-2 px-4 py-2 rounded-[9px] cursor-pointer"
                    style={{ fontSize: 16, fontWeight: 500,
                             color: dest ? '#fff' : 'rgba(255,255,255,0.3)',
                             background: dest ? 'var(--accent)' : 'rgba(255,255,255,0.06)',
                             opacity: busy ? 0.6 : 1 }}>
              {busy && <Loader2 size={14} className="animate-spin" />}
              {t('Check destination')}
            </button>
          ) : (
            <button onClick={confirmMove} disabled={!canMove || busy}
                    className="flex items-center gap-2 px-4 py-2 rounded-[9px] cursor-pointer"
                    style={{ fontSize: 16, fontWeight: 500,
                             color: canMove ? '#fff' : 'rgba(255,255,255,0.3)',
                             background: canMove ? 'var(--accent)' : 'rgba(255,255,255,0.06)',
                             opacity: busy ? 0.6 : 1 }}>
              {busy && <Loader2 size={14} className="animate-spin" />}
              {t('Move for real')}
            </button>
          )}
        </div>
      </motion.div>
    </div>,
    document.body
  )
}

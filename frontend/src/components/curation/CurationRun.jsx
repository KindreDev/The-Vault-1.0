import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useQueryClient } from '@tanstack/react-query'
import {
  Sparkles, X, ArrowRight, Check, Clock, Trash2, Loader2, Heart,
  Crosshair, FolderInput, Wand2, AlertTriangle, Flame, Scissors,
} from 'lucide-react'
import { curationApi, galleriesApi, taggerApi, imagesApi } from '../../lib/api'
import { useVaultStore } from '../../store/vault'
import { useT } from '../../i18n'
import toast from 'react-hot-toast'
import CurationBrowser from './CurationBrowser'
import CurationEditor from './CurationEditor'
import RelocateModal from '../RelocateModal'

const LANE_LABEL = {
  beloved: { text: 'Beloved creator', color: 'var(--c-pink)', bg: 'color-mix(in srgb, var(--c-pink) 15%, transparent)' },
  focus:   { text: 'Focus',           color: 'var(--c-pink)', bg: 'color-mix(in srgb, var(--c-pink) 15%, transparent)' },
  general: { text: 'Curation debt',   color: 'var(--c-accent)', bg: 'color-mix(in srgb, var(--c-accent) 15%, transparent)' },
  pinned:  { text: 'Resumed',         color: 'var(--c-amber)', bg: 'color-mix(in srgb, var(--c-amber) 15%, transparent)' },
}

// The run can be left in ways it never gets to react to — browser Back, a
// sidebar link, a crash, closing the window. A server-side pin only helps when
// there was time to make the call, so the in-progress gallery AND its unsaved
// draft are mirrored to localStorage on every keystroke. Synchronous, so it
// survives an exit path that grants no async work at all.
const SESSION_KEY = 'vault.curation.session'

const readSession = () => {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null') } catch { return null }
}
const writeSession = (galleryId, draft) => {
  try { localStorage.setItem(SESSION_KEY, JSON.stringify({ galleryId, draft, at: Date.now() })) } catch {}
}
const clearSession = () => {
  try { localStorage.removeItem(SESSION_KEY) } catch {}
}

const draftFrom = (g) => ({
  folder_name:    g.folder_name || '',
  name:           g.name || '',
  creator_ids:    (g.creators || []).map(c => c.id),
  tags:           (g.tags || []).map(t => t.name),
  rating:         g.rating || 0,
  is_favorite:    !!g.is_favorite,
  description:    g.description || '',
  period_month:   g.period_month ?? null,
  period_year:    g.period_year ?? null,
  purchase_value: g.purchase_value || 0,
  cover_image_id: null,
})

/**
 * Collection Curating — resurface one gallery at a time and fix what's wrong with it.
 *
 * Runs forever by design: there is no session cap, because the only way a 20k
 * gallery library ever gets curated is if a five-hour sitting is possible.
 *
 * Edits are STAGED, not applied on change. Heavy actions (delete, relocate, AI
 * tagging) are immediate and carry their own confirmation — they touch the
 * filesystem or spawn jobs and can't sit in a draft.
 */
export default function CurationRun({ onClose }) {
  const t = useT()
  const qc = useQueryClient()
  const addXpToast = useVaultStore(s => s.addXpToast)

  const [gallery, setGallery] = useState(null)
  const [draft, setDraft]     = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving]   = useState(false)
  const [exhausted, setExhausted] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [closePrompt, setClosePrompt]     = useState(false)
  const [relocating, setRelocating]       = useState(false)
  const [state, setState]     = useState(null)
  const [done, setDone]       = useState(0)      // galleries curated this sitting

  // ── File selection ────────────────────────────────────────────────────────
  // Every gallery-level edit here is staged, but file moves are NOT: they touch
  // the disk, like Delete and Relocate. Selection lives here rather than in the
  // browser so the action bar can sit with the other immediate actions.
  const [selected, setSelected]   = useState(() => new Set())
  const [movingFiles, setMovingFiles] = useState(false)
  const [splitting, setSplitting] = useState(false)
  const [splitName, setSplitName] = useState('')
  const [confirmFileDelete, setConfirmFileDelete] = useState(false)
  const [loadingAll, setLoadingAll] = useState(false)

  const toggleSelect = useCallback((id) => setSelected(s => {
    const n = new Set(s)
    n.has(id) ? n.delete(id) : n.add(id)
    return n
  }), [])

  // Ids already served this sitting — an unbroken run never doubles back.
  const seen = useRef([])
  // Serving a gallery consumes the resume pin, so a double-invoked load (double
  // click, a remount) would silently burn it and skip past the gallery the user
  // walked away from. One in-flight request at a time.
  const inFlight = useRef(false)

  const dirty = useMemo(() => {
    if (!gallery || !draft) return false
    const base = draftFrom(gallery)
    return Object.keys(base).some(k => JSON.stringify(base[k]) !== JSON.stringify(draft[k]))
  }, [gallery, draft])

  const patch = useCallback((d) => setDraft(p => ({ ...p, ...d })), [])

  // Mirror every edit to localStorage immediately. Cheap (one small object) and
  // the only thing that survives an exit with no async budget.
  useEffect(() => {
    if (gallery && draft) writeSession(gallery.id, draft)
  }, [gallery, draft])

  // Latest values for the unmount cleanup, which closes over its first render.
  const liveRef = useRef({ gallery: null, draft: null, dirty: false })
  useEffect(() => { liveRef.current = { gallery, draft, dirty } }, [gallery, draft, dirty])

  const refreshState = useCallback(() => {
    curationApi.state().then(r => setState(r.data)).catch(() => {})
  }, [])

  const load = useCallback(async (opts = {}) => {
    if (inFlight.current) return
    inFlight.current = true
    setLoading(true)
    setConfirmDelete(false)
    try {
      // A stored session outranks the queue: it means the last run was left
      // mid-edit, and those edits are still sitting unsaved in localStorage.
      if (opts.resume) {
        const s = readSession()
        if (s?.galleryId) {
          try {
            const r = await curationApi.gallery(s.galleryId)
            const g = r.data.gallery
            seen.current.push(g.id)
            setGallery({ ...g, lane: 'pinned' })
            setDraft({ ...draftFrom(g), ...(s.draft || {}) })
            setExhausted(false)
            return
          } catch {
            clearSession()   // gallery deleted or renamed away — fall through
          }
        }
      }

      const r = await curationApi.next(seen.current.slice(-400))
      if (r.data.exhausted || !r.data.gallery) {
        setExhausted(true)
        setGallery(null)
      } else {
        const g = r.data.gallery
        seen.current.push(g.id)
        setGallery(g)
        setDraft(draftFrom(g))
        setExhausted(false)
      }
    } catch {
      toast.error(t('Could not load the next gallery'))
    } finally {
      inFlight.current = false
      setLoading(false)
    }
  }, [t])

  useEffect(() => { load({ resume: true }); refreshState() }, [])   // eslint-disable-line react-hooks/exhaustive-deps

  // Last line of defence: however this component goes away — a sidebar link, a
  // route change, anything that never calls onClose — pin the gallery so the
  // next run comes back to it. keepalive lets the request outlive the unmount.
  useEffect(() => () => {
    const { gallery: g } = liveRef.current
    if (!g) return
    try {
      fetch('/api/curation/pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gallery_id: g.id }),
        keepalive: true,
      }).catch(() => {})
    } catch {}
  }, [])

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['vault-stats'] })
    qc.invalidateQueries({ queryKey: ['curation-debt'] })
    qc.invalidateQueries({ queryKey: ['quests'] })
    qc.invalidateQueries({ queryKey: ['profile'] })
  }

  // ── Commit + advance ──────────────────────────────────────────────────────
  const saveAndNext = async () => {
    if (!gallery || saving) return
    setSaving(true)
    try {
      const r = await curationApi.save({ gallery_id: gallery.id, ...draft, mark_curated: true })
      const xp = r.data?.xp?.amount
      if (xp) addXpToast(`+${xp} XP`)
      clearSession()
      const fixes = r.data?.fixes?.length ?? 0
      toast.success(fixes ? t('Curated — {n} fixed').replace('{n}', fixes) : t('Marked curated'))
      setDone(d => d + 1)
      invalidate()
      refreshState()
      await load()
    } catch (e) {
      toast.error(e?.response?.data?.detail || t('Could not save this gallery'))
    } finally {
      setSaving(false)
    }
  }

  const snooze = async () => {
    if (!gallery || saving) return
    setSaving(true)
    try {
      await curationApi.snooze(gallery.id)
      clearSession()
      await load()
    } catch {
      toast.error(t('Could not snooze'))
    } finally {
      setSaving(false)
    }
  }

  const doDelete = async () => {
    if (!gallery || saving) return
    setSaving(true)
    try {
      await galleriesApi.delete(gallery.id, true)
      toast.success(t('Gallery deleted'))
      clearSession()
      invalidate()
      refreshState()
      setConfirmDelete(false)
      await load()
    } catch (e) {
      const detail = e?.response?.data?.detail
      toast.error(detail?.code === 'has_children'
        ? t('This folder contains other galleries — split or move them first.')
        : (typeof detail === 'string' ? detail : t('Could not delete this gallery')))
      setConfirmDelete(false)
    } finally {
      setSaving(false)
    }
  }

  // ── File-level actions (immediate — these move bytes on disk) ─────────────
  const refreshGallery = async (all = false) => {
    const r = await curationApi.gallery(gallery.id, all)
    // Keep the lane badge; only the file list and counts are being refreshed.
    setGallery(g => ({ ...r.data.gallery, lane: g?.lane }))
    setSelected(new Set())
  }

  const loadAllFiles = async () => {
    setLoadingAll(true)
    try { await refreshGallery(true) }
    catch { toast.error(t('Could not load the rest of the files')) }
    finally { setLoadingAll(false) }
  }

  const splitSelection = async () => {
    const name = splitName.trim()
    if (!name || !selected.size) return
    setSaving(true)
    try {
      await galleriesApi.extract(gallery.id, [...selected], name)
      toast.success(t('{n} files split into a new gallery').replace('{n}', selected.size))
      setSplitting(false); setSplitName('')
      invalidate(); refreshState()
      await refreshGallery()
    } catch (e) {
      toast.error(e?.response?.data?.detail || t('Could not split those files'))
    } finally { setSaving(false) }
  }

  const deleteSelection = async () => {
    if (!selected.size) return
    setSaving(true)
    try {
      // bulkDelete's second arg is keepFile — false means the file really goes
      // from disk, which is what "delete" means here.
      await imagesApi.bulkDelete([...selected], false)
      toast.success(t('{n} files deleted').replace('{n}', selected.size))
      setConfirmFileDelete(false)
      invalidate()
      await refreshGallery()
    } catch (e) {
      toast.error(e?.response?.data?.detail || t('Could not delete those files'))
      setConfirmFileDelete(false)
    } finally { setSaving(false) }
  }

  const runAiTagging = async () => {
    try {
      await taggerApi.start({ scope: 'folder', folder_path: gallery.folder_path })
      toast.success(t('AI tagging queued for this folder'))
    } catch (e) {
      toast.error(e?.response?.data?.detail || t('Could not start AI tagging'))
    }
  }

  const backGuard = useRef(false)   // our history entry is still on the stack
  const selfPop   = useRef(false)   // ignore the popstate our own back() causes

  // Consumed only when the run closes itself. NOT on unmount: if the run went
  // away because the user clicked a sidebar link, React Router has already
  // pushed its own entry on top of ours, and calling back() here would drag
  // them off the page they just asked for.
  const consumeHistory = useCallback(() => {
    if (!backGuard.current) return
    backGuard.current = false
    selfPop.current = true
    window.history.back()
  }, [])

  // ── Closing ───────────────────────────────────────────────────────────────
  // A run interrupted mid-edit pins its gallery, so reopening lands you back on
  // it instead of throwing the half-finished work into a 20k-deep queue.
  const finishClose = async (keep) => {
    try {
      if (keep && gallery) {
        await curationApi.save({ gallery_id: gallery.id, ...draft, mark_curated: false })
        invalidate()
      }
      if (gallery) await curationApi.pin(gallery.id)
    } catch {
      toast.error(t('Could not save your changes'))
    }
    // Discarding is the one exit that should not restore the draft next time.
    if (keep) { if (gallery && draft) writeSession(gallery.id, draft) } else clearSession()
    consumeHistory()
    onClose()
  }

  const requestClose = useCallback(() => {
    if (dirty) setClosePrompt(true)
    else {
      if (gallery) curationApi.pin(gallery.id).catch(() => {})
      clearSession()
      consumeHistory()
      onClose()
    }
  }, [dirty, gallery, onClose, consumeHistory])

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !closePrompt) requestClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [requestClose, closePrompt])

  // Browser Back should back out of the run, not out of the app. A history entry
  // is pushed on open and re-pushed when Back is caught, so the run stays put
  // and the same unsaved-changes prompt gets its say.
  useEffect(() => {
    window.history.pushState({ curationRun: true }, '')
    backGuard.current = true
    const onPop = () => {
      if (selfPop.current) { selfPop.current = false; return }
      backGuard.current = false
      if (liveRef.current.dirty) {
        // Re-push so Back doesn't leave the app while the prompt is unanswered.
        window.history.pushState({ curationRun: true }, '')
        backGuard.current = true
        setClosePrompt(true)
      } else {
        const g = liveRef.current.gallery
        if (g) curationApi.pin(g.id).catch(() => {})
        clearSession()
        onClose()
      }
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [onClose])

  // A hard exit — window closed, refresh, app quit — gets one last chance to
  // pin. sendBeacon is the only request type guaranteed to survive unload.
  useEffect(() => {
    const onUnload = () => {
      const g = liveRef.current.gallery
      if (!g) return
      try {
        navigator.sendBeacon('/api/curation/pin',
          new Blob([JSON.stringify({ gallery_id: g.id })], { type: 'application/json' }))
      } catch {}
    }
    window.addEventListener('pagehide', onUnload)
    return () => window.removeEventListener('pagehide', onUnload)
  }, [])

  const lane = LANE_LABEL[gallery?.lane] || LANE_LABEL.general
  const beloved = gallery?.beloved?.[0]

  return createPortal(
    <div className="fixed inset-0 flex flex-col" style={{ background: '#0e0e0e', zIndex: 80 }}>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-4 px-5 py-3 flex-shrink-0"
           style={{ borderBottom: '0.5px solid rgba(255,255,255,0.07)', background: '#161616' }}>
        <Sparkles size={18} style={{ color: 'var(--accent, var(--c-accent))' }} />
        <div style={{ fontSize: 18, fontWeight: 500, color: 'rgba(255,255,255,0.9)' }}>
          {t('Collection Curating')}
        </div>

        {state && (
          <div className="flex items-center gap-3">
            <span style={{ fontSize: 16, color: 'rgba(255,255,255,0.35)' }}>
              {state.pending?.toLocaleString()} {t('to go')}
            </span>
            {state.streak_days > 0 && (
              <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full"
                    style={{ fontSize: 16, background: 'color-mix(in srgb, var(--c-amber) 15%, transparent)', color: 'var(--c-amber-text)' }}>
                <Flame size={13} /> {state.streak_days}
              </span>
            )}
          </div>
        )}

        <div className="flex-1" />

        {done > 0 && (
          <span className="px-3 py-1 rounded-full"
                style={{ fontSize: 16, background: 'color-mix(in srgb, var(--c-green) 18%, transparent)', color: 'var(--c-green-text)' }}>
            {done} {t('curated this sitting')}
          </span>
        )}

        {state?.focus && (
          <button onClick={() => { curationApi.focus(null).then(refreshState) }}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-full cursor-pointer"
                  style={{ fontSize: 16, background: 'color-mix(in srgb, var(--c-pink) 18%, transparent)', color: 'var(--c-pink-text)' }}>
            <Crosshair size={14} /> {state.focus.name} <X size={13} />
          </button>
        )}

        <button onClick={requestClose}
                className="cursor-pointer p-2 rounded-full"
                style={{ background: 'rgba(255,255,255,0.05)' }}>
          <X size={17} style={{ color: 'rgba(255,255,255,0.5)' }} />
        </button>
      </div>

      {/* ── Body ───────────────────────────────────────────────────────────── */}
      {loading ? (
        <div className="flex-1 flex items-center justify-center gap-3"
             style={{ color: 'rgba(255,255,255,0.35)', fontSize: 16 }}>
          <Loader2 size={20} className="animate-spin" /> {t('Finding a gallery that needs you…')}
        </div>
      ) : exhausted ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-4">
          <Check size={44} style={{ color: 'var(--c-green)' }} strokeWidth={1.5} />
          <div style={{ fontSize: 20, color: 'rgba(255,255,255,0.8)' }}>
            {t('Nothing left in the queue.')}
          </div>
          <div style={{ fontSize: 16, color: 'rgba(255,255,255,0.4)', maxWidth: 460, textAlign: 'center' }}>
            {t('Every gallery has been curated or snoozed. They cycle back in as their cooldowns expire.')}
          </div>
          <button onClick={onClose}
                  className="px-5 py-2.5 rounded-full cursor-pointer"
                  style={{ fontSize: 16, background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.8)' }}>
            {t('Close')}
          </button>
        </div>
      ) : gallery && draft ? (
        <div className="flex-1 flex overflow-hidden">
          <div className="flex-1 flex flex-col overflow-hidden">

            {/* Gallery header: what it is, and why the run pulled it up */}
            <div className="flex items-start gap-3 px-5 py-3 flex-shrink-0"
                 style={{ borderBottom: '0.5px solid rgba(255,255,255,0.07)' }}>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2.5 flex-wrap">
                  <span style={{ fontSize: 19, fontWeight: 500, color: 'rgba(255,255,255,0.92)' }}>
                    {gallery.name}
                  </span>
                  <span className="px-2.5 py-0.5 rounded-full"
                        style={{ fontSize: 16, background: lane.bg, color: lane.color }}>
                    {t(lane.text)}
                  </span>
                  <span style={{ fontSize: 16, color: 'rgba(255,255,255,0.3)' }}>
                    {gallery.image_count?.toLocaleString()} {t('files')}
                  </span>
                </div>

                {gallery.reasons?.length > 0 && (
                  <div className="flex items-center gap-1.5 flex-wrap mt-1.5">
                    <span style={{ fontSize: 16, color: 'rgba(255,255,255,0.28)' }}>{t('needs')}:</span>
                    {gallery.reasons.map(r => (
                      <span key={r} className="px-2 py-0.5 rounded-full"
                            style={{ fontSize: 16, background: 'color-mix(in srgb, var(--c-amber) 13%, transparent)', color: '#D9A85E' }}>
                        {t(r)}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* The mountain, made measurable: per-creator progress is what turns
                  "I can never curate all of this" into a bar that visibly moves. */}
              {beloved && (
                <div className="flex flex-col gap-1.5 flex-shrink-0" style={{ width: 210 }}>
                  <button
                    onClick={() => curationApi.focus(beloved.id).then(refreshState)}
                    className="flex items-center gap-1.5 cursor-pointer"
                    style={{ fontSize: 16, color: 'var(--c-pink-text)' }}
                    title={t('Focus the run on this creator')}>
                    <Heart size={12} fill="currentColor" /> {beloved.name}
                    <Crosshair size={12} style={{ opacity: 0.6 }} />
                  </button>
                  <div className="h-[5px] rounded-full overflow-hidden"
                       style={{ background: 'rgba(255,255,255,0.08)' }}>
                    <div className="h-full rounded-full transition-all"
                         style={{ width: `${beloved.pct}%`, background: 'var(--c-pink)' }} />
                  </div>
                  <span style={{ fontSize: 16, color: 'rgba(255,255,255,0.3)' }}>
                    {beloved.curated} / {beloved.total} {t('curated')}
                  </span>
                </div>
              )}
            </div>

            <CurationBrowser
              images={gallery.images}
              coverImageId={draft.cover_image_id}
              onSetCover={id => patch({ cover_image_id: id })}
              selected={selected}
              onToggleSelect={toggleSelect}
              onSelectAll={() => setSelected(s =>
                s.size === gallery.images.length ? new Set() : new Set(gallery.images.map(i => i.id)))}
              filesTotal={gallery.files_total}
              filesShown={gallery.files_shown}
              onLoadAll={loadAllFiles}
              loadingAll={loadingAll}
            />

            {/* ── Selection bar ────────────────────────────────────────────
                Appears only with a selection. These actions move or destroy
                files immediately — they cannot be staged like the sidebar. */}
            {selected.size > 0 && (
              <div className="flex items-center gap-2 px-4 py-3 flex-shrink-0 flex-wrap"
                   style={{ borderTop: '0.5px solid var(--c-pink-line)',
                            background: 'var(--c-pink-fill)' }}>
                <span style={{ fontSize: 16, color: 'var(--c-pink-text)', fontWeight: 500 }}>
                  {selected.size} {t('selected')}
                </span>
                <button onClick={() => setSelected(new Set())}
                        className="px-2.5 py-1 rounded-full cursor-pointer"
                        style={{ fontSize: 16, background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.5)' }}>
                  {t('Clear')}
                </button>

                <div className="flex-1" />

                {confirmFileDelete ? (
                  <>
                    <span style={{ fontSize: 16, color: 'var(--c-pink-text)' }}>
                      {t('Delete')} {selected.size} {t('files from disk?')}
                    </span>
                    <button onClick={() => setConfirmFileDelete(false)}
                            className="px-3 py-1.5 rounded-full cursor-pointer"
                            style={{ fontSize: 16, background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.7)' }}>
                      {t('Cancel')}
                    </button>
                    <button onClick={deleteSelection} disabled={saving}
                            className="px-3 py-1.5 rounded-full cursor-pointer disabled:opacity-50"
                            style={{ fontSize: 16, background: 'var(--c-pink)', color: 'white' }}>
                      {saving ? t('Deleting…') : t('Delete for real')}
                    </button>
                  </>
                ) : splitting ? (
                  <>
                    <input autoFocus value={splitName}
                           onChange={e => setSplitName(e.target.value)}
                           onKeyDown={e => { if (e.key === 'Enter') splitSelection() }}
                           placeholder={t('New folder name…')}
                           style={{ fontSize: 16, padding: '7px 11px', borderRadius: 8, width: 260,
                                    background: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.9)',
                                    border: '0.5px solid rgba(255,255,255,0.15)', outline: 'none' }} />
                    <button onClick={() => { setSplitting(false); setSplitName('') }}
                            className="px-3 py-1.5 rounded-full cursor-pointer"
                            style={{ fontSize: 16, background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.7)' }}>
                      {t('Cancel')}
                    </button>
                    <button onClick={splitSelection} disabled={saving || !splitName.trim()}
                            className="px-3 py-1.5 rounded-full cursor-pointer disabled:opacity-40"
                            style={{ fontSize: 16, background: 'var(--c-accent)', color: 'white' }}>
                      {saving ? t('Splitting…') : t('Create gallery')}
                    </button>
                  </>
                ) : (
                  <>
                    <button onClick={() => setMovingFiles(true)}
                            className="flex items-center gap-2 px-3.5 py-1.5 rounded-full cursor-pointer"
                            style={{ fontSize: 16, background: 'var(--c-accent-fill-2)',
                                     color: 'var(--c-accent-text)', border: '0.5px solid var(--c-accent-line)' }}>
                      <FolderInput size={15} /> {t('Move to gallery')}
                    </button>
                    <button onClick={() => setSplitting(true)}
                            className="flex items-center gap-2 px-3.5 py-1.5 rounded-full cursor-pointer"
                            style={{ fontSize: 16, background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.6)' }}>
                      <Scissors size={15} /> {t('Split into new gallery')}
                    </button>
                    <button onClick={() => setConfirmFileDelete(true)}
                            className="flex items-center gap-2 px-3.5 py-1.5 rounded-full cursor-pointer"
                            style={{ fontSize: 16, background: 'var(--c-pink-fill)', color: 'var(--c-pink)' }}>
                      <Trash2 size={15} /> {t('Delete')}
                    </button>
                  </>
                )}
              </div>
            )}
          </div>

          <CurationEditor draft={draft} patch={patch} gallery={gallery} />
        </div>
      ) : null}

      {/* ── Footer ─────────────────────────────────────────────────────────── */}
      {gallery && !loading && !exhausted && (
        <div className="flex items-center gap-2 px-5 py-3 flex-shrink-0"
             style={{ borderTop: '0.5px solid rgba(255,255,255,0.07)', background: '#161616' }}>

          {confirmDelete ? (
            /* Two-step delete: the confirm strip names exactly what is about to
               be destroyed, because this button sits in a rapid-fire flow. */
            <div className="flex items-center gap-3 flex-1 rounded-[10px] px-4 py-2.5"
                 style={{ background: 'color-mix(in srgb, var(--c-pink) 12%, transparent)', border: '0.5px solid color-mix(in srgb, var(--c-pink) 40%, transparent)' }}>
              <AlertTriangle size={17} style={{ color: 'var(--c-pink)', flexShrink: 0 }} />
              <div className="flex-1 min-w-0">
                <div style={{ fontSize: 16, color: 'var(--c-pink-text)' }}>
                  {t('Permanently delete')} <strong>{gallery.name}</strong> — {gallery.image_count?.toLocaleString()} {t('files, from disk')}
                </div>
                <div className="truncate" style={{ fontSize: 16, color: 'rgba(255,255,255,0.35)' }}>
                  {gallery.folder_path}
                </div>
              </div>
              <button onClick={() => setConfirmDelete(false)}
                      className="px-4 py-2 rounded-full cursor-pointer flex-shrink-0"
                      style={{ fontSize: 16, background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.7)' }}>
                {t('Cancel')}
              </button>
              <button onClick={doDelete} disabled={saving}
                      className="px-4 py-2 rounded-full cursor-pointer flex-shrink-0 disabled:opacity-50"
                      style={{ fontSize: 16, background: 'var(--c-pink)', color: 'white' }}>
                {saving ? t('Deleting…') : t('Delete for real')}
              </button>
            </div>
          ) : (
            <>
              <button onClick={() => setConfirmDelete(true)}
                      className="flex items-center gap-2 px-3.5 py-2 rounded-full cursor-pointer"
                      style={{ fontSize: 16, background: 'color-mix(in srgb, var(--c-pink) 12%, transparent)', color: 'var(--c-pink)' }}>
                <Trash2 size={15} /> {t('Delete')}
              </button>

              <button onClick={() => setRelocating(true)}
                      className="flex items-center gap-2 px-3.5 py-2 rounded-full cursor-pointer"
                      style={{ fontSize: 16, background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.55)' }}>
                <FolderInput size={15} /> {t('Move')}
              </button>

              <button onClick={runAiTagging}
                      className="flex items-center gap-2 px-3.5 py-2 rounded-full cursor-pointer"
                      style={{ fontSize: 16, background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.55)' }}>
                <Wand2 size={15} /> {t('AI tag')}
              </button>

              <div className="flex-1" />

              <button onClick={snooze} disabled={saving}
                      className="flex items-center gap-2 px-4 py-2 rounded-full cursor-pointer disabled:opacity-50"
                      style={{ fontSize: 16, background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.55)' }}>
                <Clock size={15} /> {t('Not now')}
              </button>

              {/* The fast path. Most galleries should leave through this button in
                  under two seconds, or the run becomes a chore and dies. */}
              <button onClick={saveAndNext} disabled={saving}
                      className="flex items-center gap-2 px-5 py-2 rounded-full cursor-pointer disabled:opacity-50"
                      style={{
                        fontSize: 16, fontWeight: 500,
                        background: dirty ? 'var(--accent, var(--c-accent))' : 'color-mix(in srgb, var(--c-green) 20%, transparent)',
                        color: dirty ? 'white' : 'var(--c-green-text)',
                        border: dirty ? 'none' : '0.5px solid color-mix(in srgb, var(--c-green) 40%, transparent)',
                      }}>
                {saving
                  ? <Loader2 size={15} className="animate-spin" />
                  : dirty ? <Check size={15} /> : <ArrowRight size={15} />}
                {saving ? t('Saving…') : dirty ? t('Save & next') : t('Looks good — next')}
              </button>
            </>
          )}
        </div>
      )}

      {/* ── Unsaved-changes prompt ─────────────────────────────────────────── */}
      {closePrompt && (
        <div className="fixed inset-0 flex items-center justify-center"
             style={{ background: 'rgba(0,0,0,0.8)', zIndex: 95 }}>
          <div className="rounded-[14px] p-5 flex flex-col gap-4"
               style={{ width: 460, background: '#1a1a1a', border: '0.5px solid rgba(255,255,255,0.12)' }}>
            <div style={{ fontSize: 17, color: 'rgba(255,255,255,0.9)' }}>
              {t('Keep your changes to')} <strong>{gallery?.name}</strong>?
            </div>
            <div style={{ fontSize: 16, color: 'rgba(255,255,255,0.45)' }}>
              {t("Either way this gallery is saved for next time — you'll come back to it.")}
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setClosePrompt(false)}
                      className="px-4 py-2 rounded-full cursor-pointer"
                      style={{ fontSize: 16, background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.6)' }}>
                {t('Back to the run')}
              </button>
              <button onClick={() => finishClose(false)}
                      className="px-4 py-2 rounded-full cursor-pointer"
                      style={{ fontSize: 16, background: 'color-mix(in srgb, var(--c-pink) 15%, transparent)', color: 'var(--c-pink-text)' }}>
                {t('Discard')}
              </button>
              <button onClick={() => finishClose(true)}
                      className="px-4 py-2 rounded-full cursor-pointer"
                      style={{ fontSize: 16, background: 'var(--accent, var(--c-accent))', color: 'white' }}>
                {t('Keep & finish')}
              </button>
            </div>
          </div>
        </div>
      )}

      {relocating && gallery && (
        <RelocateModal
          mode="galleries"
          galleries={[{ id: gallery.id, name: gallery.name, folder_path: gallery.folder_path }]}
          onClose={() => setRelocating(false)}
          onDone={() => { setRelocating(false); load() }}
        />
      )}

      {/* Moving files reuses the same modal the rest of the app uses, in its
          images mode — files land inside a real gallery's folder, never loose. */}
      {movingFiles && gallery && selected.size > 0 && (
        <RelocateModal
          mode="images"
          images={gallery.images.filter(i => selected.has(i.id))}
          onClose={() => setMovingFiles(false)}
          onDone={() => { setMovingFiles(false); invalidate(); refreshGallery() }}
        />
      )}
    </div>,
    document.body,
  )
}

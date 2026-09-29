import React, { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useQueryClient } from '@tanstack/react-query'
import { AlertCircle, AlertTriangle, ArrowRight, Check, Clock, Flame, FolderInput, Loader2, Sparkles, Trash2, Wand2, X } from 'lucide-react'
import toast from 'react-hot-toast'
import { curationApi, imagesApi, taggerApi } from '../../lib/api'
import { useVaultStore } from '../../store/vault'
import { useScrollLock } from '../../hooks/useScrollLock'
import { useT } from '../../i18n'
import { useVideoLoop } from '../../lib/videoLoop'
import FileCurationEditor from './FileCurationEditor'
import RelocateModal from '../RelocateModal'

const draftFrom = file => ({
  rating: file.rating || 0,
  is_favorite: !!file.is_favorite,
  notes: file.notes || '',
  file_creator_ids: file.file_creator_ids || [],
  has_image_creators: !!file.has_image_creators,
})

export default function FileCurationRun({ onClose }) {
  const t = useT()
  const loopVideo = useVideoLoop()
  const qc = useQueryClient()
  const addXpToast = useVaultStore(s => s.addXpToast)
  const [file, setFile] = useState(null)
  const [draft, setDraft] = useState(null)
  const [tags, setTags] = useState([])
  const [creators, setCreators] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)
  const [saving, setSaving] = useState(false)
  const [exhausted, setExhausted] = useState(false)
  const [done, setDone] = useState(0)
  const [pending, setPending] = useState(null)
  const [state, setState] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [relocating, setRelocating] = useState(false)
  const seen = useRef([])
  const inFlight = useRef(false)

  useScrollLock()

  const refreshDebt = useCallback(() => {
    curationApi.debt('file').then(r => setPending(r.data?.pending ?? null)).catch(() => {})
    curationApi.state().then(r => setState(r.data)).catch(() => {})
  }, [])

  const load = useCallback(async () => {
    if (inFlight.current) return
    inFlight.current = true
    setLoading(true)
    setLoadError(null)
    setConfirmDelete(false)
    try {
      const r = await curationApi.nextFile(seen.current.slice(-400))
      if (r.data.exhausted || !r.data.file) {
        setFile(null)
        setExhausted(true)
      } else {
        const next = r.data.file
        seen.current.push(next.id)
        setFile(next)
        setDraft(draftFrom(next))
        setTags(next.tags || [])
        setCreators(next.creators || [])
        setExhausted(false)
      }
      refreshDebt()
    } catch (e) {
      const message = e?.response?.data?.detail || t('Could not load the next file')
      setFile(null)
      setDraft(null)
      setLoadError(message)
      toast.error(message)
    } finally {
      inFlight.current = false
      setLoading(false)
    }
  }, [refreshDebt, t])

  // `useT()` returns a new function on each render. This must stay a mount-only
  // effect or every loading-state update would start another queue request.
  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = event => {
      if (event.key === 'Escape') { event.preventDefault(); onClose() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const patch = useCallback(next => setDraft(current => ({ ...current, ...next })), [])

  const saveAndNext = async () => {
    if (!file || !draft || saving) return
    setSaving(true)
    try {
      const r = await curationApi.saveFile({
        image_id: file.id,
        creator_ids: draft.file_creator_ids,
        tags: tags.map(tag => tag.name),
        rating: draft.rating,
        is_favorite: draft.is_favorite,
        notes: draft.notes,
        mark_curated: true,
      })
      const xp = r.data?.xp?.amount
      if (xp) addXpToast(`+${xp} XP`)
      setDone(count => count + 1)
      toast.success(r.data?.fixes?.length ? t('File curated — {n} fixed').replace('{n}', r.data.fixes.length) : t('File marked curated'))
      await load()
    } catch (e) {
      toast.error(e?.response?.data?.detail || t('Could not save this file'))
    } finally {
      setSaving(false)
    }
  }

  const later = async () => {
    if (!file || saving) return
    setSaving(true)
    try {
      await curationApi.snoozeFile(file.id)
      await load()
    } catch (e) {
      toast.error(e?.response?.data?.detail || t('Could not snooze this file'))
    } finally {
      setSaving(false)
    }
  }

  const deleteFile = async () => {
    if (!file || saving) return
    setSaving(true)
    try {
      await imagesApi.delete(file.id, false)
      toast.success(t('File deleted'))
      setConfirmDelete(false)
      qc.invalidateQueries({ queryKey: ['images'] })
      qc.invalidateQueries({ queryKey: ['galleries'] })
      qc.invalidateQueries({ queryKey: ['vault-stats'] })
      await load()
    } catch (e) {
      toast.error(e?.response?.data?.detail || t('Could not delete this file'))
      setConfirmDelete(false)
    } finally {
      setSaving(false)
    }
  }

  const runAiTagging = async () => {
    if (!file || saving) return
    try {
      await taggerApi.start({ scope: 'image', image_id: file.id })
      toast.success(t('AI tagging queued for this file'))
    } catch (e) {
      toast.error(e?.response?.data?.detail || t('Could not start AI tagging'))
    }
  }

  const body = loading ? (
    <div className="flex-1 flex items-center justify-center gap-3" style={{ color: 'rgba(255,255,255,0.35)', fontSize: 16 }}>
      <Loader2 size={20} className="animate-spin" /> {t('Finding a file that needs you…')}
    </div>
  ) : loadError ? (
    <div className="flex-1 flex flex-col items-center justify-center gap-4">
      <AlertCircle size={44} style={{ color: 'var(--c-pink)' }} strokeWidth={1.5} />
      <div style={{ fontSize: 20, color: 'rgba(255,255,255,0.8)' }}>{t('The file queue could not be loaded.')}</div>
      <div style={{ fontSize: 16, color: 'rgba(255,255,255,0.45)', maxWidth: 560, textAlign: 'center' }}>{loadError}</div>
      <button type="button" onClick={load} disabled={loading}
              className="flex items-center gap-2 px-5 py-2 rounded-full cursor-pointer disabled:opacity-50"
              style={{ fontSize: 16, background: 'var(--c-accent)', color: 'white' }}>
        {loading && <Loader2 size={15} className="animate-spin" />}
        {t('Try again')}
      </button>
    </div>
  ) : exhausted ? (
    <div className="flex-1 flex flex-col items-center justify-center gap-4">
      <Check size={44} style={{ color: 'var(--c-green)' }} strokeWidth={1.5} />
      <div style={{ fontSize: 20, color: 'rgba(255,255,255,0.8)' }}>{t('Nothing left in the file queue.')}</div>
      <div style={{ fontSize: 16, color: 'rgba(255,255,255,0.4)', maxWidth: 480, textAlign: 'center' }}>
        {t('Every file has been curated or snoozed. They cycle back in as their cooldowns expire.')}
      </div>
    </div>
  ) : file && draft ? (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
      {/* File header mirrors gallery curation: identity first, then the debt
          signals that explain why this item was selected. */}
      <div className="flex items-start gap-3 px-5 py-3 flex-shrink-0"
           style={{ borderBottom: '0.5px solid rgba(255,255,255,0.07)' }}>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2.5 flex-wrap">
            <span className="truncate" style={{ fontSize: 19, fontWeight: 500, color: 'rgba(255,255,255,0.92)' }} title={file.filename}>
              {file.filename}
            </span>
            <span className="px-2.5 py-0.5 rounded-full"
                  style={{ fontSize: 16, background: 'color-mix(in srgb, var(--c-accent) 15%, transparent)', color: 'var(--c-accent-text)' }}>
              {file.is_video ? t('Video') : t('Image')}
            </span>
            <span className="truncate" style={{ fontSize: 16, color: 'rgba(255,255,255,0.3)' }}>
              {file.gallery_name || t('Unassigned gallery')}
            </span>
          </div>

          {file.reasons?.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap mt-1.5">
              <span style={{ fontSize: 16, color: 'rgba(255,255,255,0.28)' }}>{t('needs')}:</span>
              {file.reasons.map(reason => (
                <span key={reason} className="px-2 py-0.5 rounded-full"
                      style={{ fontSize: 16, background: 'color-mix(in srgb, var(--c-amber) 13%, transparent)', color: '#D9A85E' }}>
                  {t(reason)}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 min-h-0 flex overflow-hidden">
        <main className="flex-1 min-w-0 min-h-0 flex flex-col">
          <div className="flex-1 min-h-0 flex items-center justify-center p-6 overflow-hidden" style={{ background: '#090909' }}>
            {file.is_video
              ? <video src={file.file_url} controls autoPlay loop={loopVideo} preload="metadata"
                       style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
              : <img src={file.file_url} alt={file.filename}
                     style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />}
          </div>
        </main>
        <FileCurationEditor
          file={file}
          draft={draft}
          patch={patch}
          tags={tags}
          onTagsChanged={setTags}
          creators={creators}
          onCreatorsChanged={setCreators}
          onHasImageCreatorsChanged={value => setDraft(current => ({ ...current, has_image_creators: typeof value === 'function' ? value(current.has_image_creators) : value }))}
          onFileCreatorIdsChanged={value => setDraft(current => ({ ...current, file_creator_ids: typeof value === 'function' ? value(current.file_creator_ids) : value }))}
        />
      </div>
    </div>
  ) : null

  return createPortal(
    <div className="fixed inset-0 flex flex-col" style={{ background: '#0e0e0e', zIndex: 80 }}>
      <header className="flex items-center gap-3 px-5 py-3 flex-shrink-0"
              style={{ borderBottom: '0.5px solid rgba(255,255,255,0.07)', background: '#161616' }}>
        <Sparkles size={18} style={{ color: 'var(--accent, var(--c-accent))' }} />
        <div style={{ fontSize: 18, fontWeight: 500, color: 'rgba(255,255,255,0.9)' }}>{t('Collection Curating')}</div>
        {pending !== null && <span style={{ fontSize: 16, color: 'rgba(255,255,255,0.35)' }}>{pending.toLocaleString()} {t('files to go')}</span>}
        {state?.streak_days > 0 && (
          <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full"
                style={{ fontSize: 16, background: 'color-mix(in srgb, var(--c-amber) 15%, transparent)', color: 'var(--c-amber-text)' }}>
            <Flame size={13} /> {state.streak_days}
          </span>
        )}
        <div className="flex-1" />
        {done > 0 && <span className="px-3 py-1 rounded-full" style={{ fontSize: 16, background: 'var(--c-green-fill)', color: 'var(--c-green-text)' }}>{done} {t('curated this sitting')}</span>}
        <button type="button" onClick={onClose} className="cursor-pointer p-2 rounded-full" style={{ background: 'rgba(255,255,255,0.05)' }}>
          <X size={17} style={{ color: 'rgba(255,255,255,0.5)' }} />
        </button>
      </header>

      {body}

      {file && !loading && !exhausted && (
        <footer className="flex items-center gap-2 px-5 py-3 flex-shrink-0"
                style={{ borderTop: '0.5px solid rgba(255,255,255,0.07)', background: '#161616' }}>
          {confirmDelete ? (
            <div className="flex items-center gap-3 flex-1 rounded-[10px] px-4 py-2.5"
                 style={{ background: 'color-mix(in srgb, var(--c-pink) 12%, transparent)', border: '0.5px solid color-mix(in srgb, var(--c-pink) 40%, transparent)' }}>
              <AlertTriangle size={17} style={{ color: 'var(--c-pink)', flexShrink: 0 }} />
              <div className="flex-1 min-w-0">
                <div className="truncate" style={{ fontSize: 16, color: 'var(--c-pink-text)' }}>
                  {t('Permanently delete')} <strong>{file.filename}</strong>?
                </div>
                <div className="truncate" style={{ fontSize: 16, color: 'rgba(255,255,255,0.35)' }}>
                  {file.file_path}
                </div>
              </div>
              <button type="button" onClick={() => setConfirmDelete(false)}
                      className="px-4 py-2 rounded-full cursor-pointer flex-shrink-0"
                      style={{ fontSize: 16, background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.7)' }}>
                {t('Cancel')}
              </button>
              <button type="button" onClick={deleteFile} disabled={saving}
                      className="px-4 py-2 rounded-full cursor-pointer flex-shrink-0 disabled:opacity-50"
                      style={{ fontSize: 16, background: 'var(--c-pink)', color: 'white' }}>
                {saving ? t('Deleting…') : t('Delete for real')}
              </button>
            </div>
          ) : (
            <>
              <button type="button" onClick={() => setConfirmDelete(true)} disabled={saving}
                      className="flex items-center gap-2 px-3.5 py-2 rounded-full cursor-pointer disabled:opacity-50"
                      style={{ fontSize: 16, background: 'color-mix(in srgb, var(--c-pink) 12%, transparent)', color: 'var(--c-pink)' }}>
                <Trash2 size={15} /> {t('Delete')}
              </button>

              <button type="button" onClick={() => setRelocating(true)} disabled={saving}
                      className="flex items-center gap-2 px-3.5 py-2 rounded-full cursor-pointer disabled:opacity-50"
                      style={{ fontSize: 16, background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.55)' }}>
                <FolderInput size={15} /> {t('Move')}
              </button>

              <button type="button" onClick={runAiTagging} disabled={saving}
                      className="flex items-center gap-2 px-3.5 py-2 rounded-full cursor-pointer disabled:opacity-50"
                      style={{ fontSize: 16, background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.55)' }}>
                <Wand2 size={15} /> {t('AI tag')}
              </button>

              <div className="flex-1" />

              <button type="button" onClick={later} disabled={saving}
                      className="flex items-center gap-2 px-4 py-2 rounded-full cursor-pointer disabled:opacity-50"
                      style={{ fontSize: 16, background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.55)' }}>
                <Clock size={15} /> {t('Not now')}
              </button>
              <button type="button" onClick={saveAndNext} disabled={saving}
                      className="flex items-center gap-2 px-5 py-2 rounded-full cursor-pointer disabled:opacity-50"
                      style={{
                        fontSize: 16, fontWeight: 500,
                        background: 'color-mix(in srgb, var(--c-green) 20%, transparent)',
                        color: 'var(--c-green-text)',
                        border: '0.5px solid color-mix(in srgb, var(--c-green) 40%, transparent)',
                      }}>
                {saving ? <Loader2 size={15} className="animate-spin" /> : <ArrowRight size={15} />}
                {saving ? t('Saving…') : t('Looks good — next')}
              </button>
            </>
          )}
        </footer>
      )}

      {relocating && file && (
        <RelocateModal
          mode="images"
          images={[file]}
          onClose={() => setRelocating(false)}
          onDone={() => { setRelocating(false); load() }}
        />
      )}
    </div>,
    document.body,
  )
}

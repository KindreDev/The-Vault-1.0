import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import {
  X, Star, Heart, Crosshair, Plus, Undo2, Clock, ArrowRight, Loader2, Flame,
  ChevronDown, Search, FolderOpen, Wand2, Trash2, Copy, Check, Volume2, VolumeX,
} from 'lucide-react'
import { curationApi, creatorsApi, tagsApi } from '../lib/api.js'
import { abs } from '../lib/server.js'
import { useVaultStore } from '../store/vault.js'
import { goBack } from '../lib/nav.js'

// Swipe curating — one file at a time. Rate and swipe on the first screen;
// tags, notes and the heavier actions sit below for when they're wanted.
//   swipe right → save and next · swipe left → not now · double tap → favorite

const SWIPE_COMMIT = 90      // px past which a release commits the swipe
const HISTORY_MAX  = 20
const EASE = [0.22, 1, 0.36, 1]

const draftFrom = (f) => ({
  rating: f.rating || 0,
  is_favorite: !!f.is_favorite,
  notes: f.notes || '',
  file_creator_ids: f.file_creator_ids || [],
  tags: (f.tags || []).map(t => t.name),
})

export default function Curate() {
  const nav = useNavigate()
  const addToast = useVaultStore(s => s.addToast)

  const [file, setFile]       = useState(null)
  const [draft, setDraft]     = useState(null)
  const [creators, setCreators] = useState([])   // display objects for every creator shown
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
  const [exhausted, setExhausted] = useState(false)
  const [busy, setBusy]       = useState(false)
  const [state, setState]     = useState(null)
  const [pending, setPending] = useState(null)
  const [done, setDone]       = useState(0)
  const [historyLen, setHistoryLen] = useState(0)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [sheet, setSheet]     = useState(null)    // 'creator' | 'tag' | null

  const seen     = useRef([])
  const history  = useRef([])     // [{ file, draft, creators, action }]
  const prefetch = useRef(null)   // Promise<file|null> for the next file
  const restored = useRef(null)   // action of the history entry currently shown again
  const videoRef = useRef(null)

  const refreshState = useCallback(() => {
    curationApi.state().then(r => setState(r.data)).catch(() => {})
    curationApi.debt().then(r => setPending(r.data?.pending ?? null)).catch(() => {})
  }, [])

  const fetchNext = useCallback(() =>
    curationApi.nextFile(seen.current.slice(-400)).then(r => (r.data.exhausted ? null : r.data.file)), [])

  // Warm the next file (and its image) while this one is being judged, so a
  // swipe lands on something already loaded.
  const startPrefetch = useCallback(() => {
    const p = fetchNext().catch(() => undefined)
    p.then(f => { if (f && !f.is_video) { const img = new Image(); img.src = abs(f.file_url) } })
    prefetch.current = p
  }, [fetchNext])

  const show = useCallback((f, d = null, shownCreators = null) => {
    if (!seen.current.includes(f.id)) seen.current.push(f.id)
    setFile(f)
    setDraft(d || draftFrom(f))
    setCreators(shownCreators || f.creators || [])
    setConfirmDelete(false)
    setExhausted(false)
    window.scrollTo({ top: 0 })
  }, [])

  const loadNext = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      let next = prefetch.current ? await prefetch.current : undefined
      prefetch.current = null
      if (next === undefined || (next && seen.current.includes(next.id))) next = await fetchNext()
      if (!next) { setFile(null); setExhausted(true) }
      else { show(next); startPrefetch() }
      refreshState()
    } catch (e) {
      setError(e?.response?.data?.detail || 'Could not load the next file')
    } finally {
      setLoading(false)
    }
  }, [fetchNext, show, startPrefetch, refreshState])

  useEffect(() => { loadNext() }, [])   // eslint-disable-line react-hooks/exhaustive-deps

  const patch = (d) => setDraft(cur => ({ ...cur, ...d }))

  const pushHistory = (action) => {
    history.current.push({ file, draft, creators, action })
    if (history.current.length > HISTORY_MAX) history.current.shift()
    setHistoryLen(history.current.length)
  }

  // ── Actions ─────────────────────────────────────────────────────────────
  const saveAndNext = async () => {
    if (!file || busy) return
    setBusy(true)
    try {
      await curationApi.saveFile({
        image_id: file.id,
        creator_ids: draft.file_creator_ids,
        tags: draft.tags,
        rating: draft.rating,
        is_favorite: draft.is_favorite,
        notes: draft.notes,
        // Re-saving a file brought back by Undo: it already counted as curated.
        mark_curated: restored.current !== 'save',
      })
      if (restored.current !== 'save') setDone(n => n + 1)
      restored.current = null
      pushHistory('save')
      await loadNext()
    } catch (e) {
      addToast(e?.response?.data?.detail || 'Could not save this file', 'info')
    } finally {
      setBusy(false)
    }
  }

  const later = async () => {
    if (!file || busy) return
    setBusy(true)
    try {
      await curationApi.snoozeFile(file.id)
      restored.current = null
      pushHistory('snooze')
      await loadNext()
    } catch (e) {
      addToast(e?.response?.data?.detail || 'Could not skip this file', 'info')
    } finally {
      setBusy(false)
    }
  }

  // Undo brings the previous file back exactly as it was left. The file that
  // was on screen goes back to the front of the queue.
  const undo = () => {
    if (busy || !history.current.length) return
    const prev = history.current.pop()
    setHistoryLen(history.current.length)
    if (file) {
      seen.current = seen.current.filter(id => id !== file.id)
      const current = file
      prefetch.current = Promise.resolve(current)
    }
    restored.current = prev.action
    show(prev.file, prev.draft, prev.creators)
  }

  const deleteFile = async () => {
    if (!file || busy) return
    setBusy(true)
    try {
      // Let go of the stream first so the server isn't holding the file open.
      if (videoRef.current) { videoRef.current.pause(); videoRef.current.removeAttribute('src'); videoRef.current.load() }
      await curationApi.deleteFile(file.id)
      addToast('File deleted', 'info')
      restored.current = null
      await loadNext()
    } catch (e) {
      addToast(e?.response?.data?.detail || 'Could not delete this file', 'info')
      setConfirmDelete(false)
    } finally {
      setBusy(false)
    }
  }

  const aiTag = () => {
    if (!file) return
    curationApi.aiTag(file.id)
      .then(() => addToast('AI tagging queued for this file', 'info'))
      .catch(e => addToast(e?.response?.data?.detail || 'Could not start AI tagging', 'info'))
  }

  // Focus applies at once: if the file on screen isn't hers, jump straight to
  // one that is (the skipped file isn't snoozed; it just comes back later).
  const setFocus = (creatorId, name) => {
    curationApi.focus(creatorId)
      .then(() => {
        prefetch.current = null   // the warmed file may not match the new focus
        refreshState()
        if (!creatorId) { addToast('Focus cleared', 'info'); return }
        addToast(`Focusing on ${name || 'this creator'}`, 'info')
        if (!creators.some(c => c.id === creatorId)) loadNext()
      })
      .catch(() => addToast('Could not change focus', 'info'))
  }

  // ── Creators ────────────────────────────────────────────────────────────
  const fileIds = draft?.file_creator_ids || []
  const addCreator = (c) => {
    if (creators.some(x => x.id === c.id)) return
    setCreators(cur => [...cur, { id: c.id, name: c.name, creator_type: c.creator_type }])
    patch({ file_creator_ids: [...fileIds, c.id] })
  }
  const removeCreator = (id) => {
    setCreators(cur => cur.filter(c => c.id !== id))
    patch({ file_creator_ids: fileIds.filter(x => x !== id) })
  }
  // Focus runs serve the same girl over and over — one tap copies the last
  // file's creators instead of picking them again.
  const lastCreators = history.current.length ? history.current[history.current.length - 1].creators : []
  const missingFromLast = file ? lastCreators.filter(c => !creators.some(x => x.id === c.id)) : []

  // ── Swipe + tap gestures on the media ───────────────────────────────────
  const [dx, setDx] = useState(0)
  const [flying, setFlying] = useState(0)        // -1 / 1 while a committed swipe animates out
  const [heart, setHeart] = useState(0)
  const [muted, setMuted] = useState(true)
  const touch = useRef(null)
  const lastTap = useRef(0)
  const tapTimer = useRef(null)

  const onTouchStart = (e) => {
    if (busy) return
    const t = e.touches[0]
    touch.current = { x: t.clientX, y: t.clientY, lock: null }
  }
  const onTouchMove = (e) => {
    const s = touch.current
    if (!s) return
    const t = e.touches[0]
    const mx = t.clientX - s.x, my = t.clientY - s.y
    if (!s.lock) {
      if (Math.abs(mx) > 10 && Math.abs(mx) > Math.abs(my)) s.lock = 'h'
      else if (Math.abs(my) > 10) s.lock = 'v'
    }
    if (s.lock === 'h') setDx(mx)
  }
  const onTouchEnd = () => {
    const s = touch.current
    touch.current = null
    if (!s) return
    if (s.lock === 'h') {
      if (Math.abs(dx) > SWIPE_COMMIT) {
        const dir = dx > 0 ? 1 : -1
        setFlying(dir)
        setTimeout(() => {
          setFlying(0); setDx(0)
          if (dir > 0) saveAndNext(); else later()
        }, 160)
      } else setDx(0)
      return
    }
    if (s.lock) return
    // A tap: two within 280ms favorite the file, one alone toggles video sound.
    const now = Date.now()
    if (now - lastTap.current < 280) {
      clearTimeout(tapTimer.current)
      lastTap.current = 0
      patch({ is_favorite: true })
      setHeart(h => h + 1)
    } else {
      lastTap.current = now
      tapTimer.current = setTimeout(() => {
        if (file?.is_video) setMuted(m => !m)
      }, 280)
    }
  }
  useEffect(() => () => clearTimeout(tapTimer.current), [])
  // React doesn't reliably reflect `muted` onto the element, and autoplay
  // needs it set for real.
  useEffect(() => { if (videoRef.current) videoRef.current.muted = muted }, [muted, file])

  const offset = flying ? flying * window.innerWidth : dx
  const nextHint = Math.min(1, Math.max(0, dx / SWIPE_COMMIT))
  const laterHint = Math.min(1, Math.max(0, -dx / SWIPE_COMMIT))

  // ── Render ──────────────────────────────────────────────────────────────
  const header = (
    <div className="flex items-center gap-2 px-3 pt-[calc(var(--sat)+10px)] pb-2">
      <button onClick={() => goBack(nav, '/')} className="p-2 -ml-1 rounded-full active:bg-white/10" aria-label="Close">
        <X size={22} style={{ color: 'rgba(255,255,255,0.7)' }} />
      </button>
      <div className="flex-1 min-w-0 flex items-center gap-2 text-[14px]" style={{ color: 'rgba(255,255,255,0.45)' }}>
        {pending !== null && <span className="truncate">{pending.toLocaleString()} to go</span>}
        {state?.streak_days > 0 && (
          <span className="flex items-center gap-1 shrink-0" style={{ color: 'var(--c-amber)' }}>
            <Flame size={14} /> {state.streak_days}
          </span>
        )}
        {done > 0 && <span className="shrink-0" style={{ color: 'var(--c-green)' }}>· {done} done</span>}
      </div>
      {!state?.focus && (
        <button onClick={() => setSheet('focus')}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[13px]"
                style={{ background: 'var(--c-card)', color: 'rgba(255,255,255,0.7)' }}>
          <Crosshair size={13} /> Focus
        </button>
      )}
      {state?.focus && (
        <button onClick={() => setFocus(null)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[13px] max-w-[45%]"
                style={{ background: 'color-mix(in srgb, var(--c-pink) 20%, transparent)', color: '#F0A3BD' }}>
          <Crosshair size={13} className="shrink-0" />
          <span className="truncate">{state.focus.name}</span>
          <X size={12} className="shrink-0" />
        </button>
      )}
    </div>
  )

  if (loading && !file) {
    return (
      <div className="min-h-screen flex flex-col" style={{ background: 'var(--c-bg)' }}>
        {header}
        <div className="flex-1 flex items-center justify-center gap-2 text-[15px]" style={{ color: 'rgba(255,255,255,0.4)' }}>
          <Loader2 size={20} className="animate-spin" /> Finding a file that needs you…
        </div>
      </div>
    )
  }

  if (error || exhausted || !file || !draft) {
    return (
      <div className="min-h-screen flex flex-col" style={{ background: 'var(--c-bg)' }}>
        {header}
        <div className="flex-1 flex flex-col items-center justify-center gap-4 px-8 text-center">
          {exhausted
            ? <><Check size={44} style={{ color: 'var(--c-green)' }} strokeWidth={1.5} />
                <div className="text-lg">Nothing left in the file queue</div>
                <div className="text-[14px]" style={{ color: 'rgba(255,255,255,0.4)' }}>Files cycle back in as their cooldowns expire.</div></>
            : <><div className="text-lg">The file queue couldn't load</div>
                <div className="text-[14px]" style={{ color: 'rgba(255,255,255,0.4)' }}>{error}</div>
                <button onClick={loadNext} className="px-5 py-2.5 rounded-full text-[15px]" style={{ background: 'var(--accent)' }}>Try again</button></>}
        </div>
        <CreatorSheet open={sheet === 'focus'} onClose={() => setSheet(null)} title="Focus the run on…"
                      taken={[]} onPick={c => { setSheet(null); setFocus(c.id, c.name) }} />
      </div>
    )
  }

  return (
    <div className="min-h-screen" style={{ background: 'var(--c-bg)' }}>
      {header}

      {/* Media — the swipe surface */}
      <div className="px-3">
        <div data-hswipe
             className="relative rounded-2xl overflow-hidden flex items-center justify-center select-none"
             style={{ height: '56vh', background: '#090909', touchAction: 'pan-y' }}
             onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>
          <div className="w-full h-full flex items-center justify-center"
               style={{
                 transform: `translateX(${offset}px) rotate(${offset / 28}deg)`,
                 transition: touch.current ? 'none' : 'transform 0.18s ease-out',
               }}>
            {file.is_video
              ? <video key={file.id} ref={videoRef} src={abs(file.file_url)} autoPlay loop muted={muted} playsInline
                       className="max-w-full max-h-full object-contain pointer-events-none" />
              : <img key={file.id} src={abs(file.file_url)} alt="" draggable={false}
                     className="max-w-full max-h-full object-contain pointer-events-none" />}
          </div>

          {/* Swipe feedback */}
          <div className="absolute top-4 left-4 px-3 py-1.5 rounded-lg text-[15px] font-bold border-2 pointer-events-none"
               style={{ opacity: nextHint, color: 'var(--c-green)', borderColor: 'var(--c-green)', transform: 'rotate(-10deg)' }}>
            NEXT
          </div>
          <div className="absolute top-4 right-4 px-3 py-1.5 rounded-lg text-[15px] font-bold border-2 pointer-events-none"
               style={{ opacity: laterHint, color: 'var(--c-amber)', borderColor: 'var(--c-amber)', transform: 'rotate(10deg)' }}>
            NOT NOW
          </div>

          <AnimatePresence>
            {heart > 0 && (
              <motion.div key={heart} className="absolute pointer-events-none"
                          initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1.15, opacity: 1 }} exit={{ opacity: 0 }}
                          transition={{ duration: 0.25 }}
                          onAnimationComplete={() => setTimeout(() => setHeart(0), 350)}>
                <Heart size={96} fill="var(--c-pink)" color="var(--c-pink)" />
              </motion.div>
            )}
          </AnimatePresence>

          {draft.is_favorite && (
            <button onClick={() => patch({ is_favorite: false })}
                    className="absolute bottom-3 right-3 p-2 rounded-full" style={{ background: 'rgba(0,0,0,0.5)' }}
                    aria-label="Remove favorite">
              <Heart size={20} fill="var(--c-pink)" color="var(--c-pink)" />
            </button>
          )}
          {file.is_video && (
            <div className="absolute bottom-3 left-3 p-2 rounded-full pointer-events-none" style={{ background: 'rgba(0,0,0,0.5)' }}>
              {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
            </div>
          )}
          {busy && (
            <div className="absolute inset-0 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.35)' }}>
              <Loader2 size={28} className="animate-spin" />
            </div>
          )}
        </div>
      </div>

      {/* Identity + creators — always on the first screen */}
      <div className="px-4 mt-2.5">
        <div className="flex items-baseline gap-2 min-w-0">
          <span className="text-[15px] font-medium truncate">{file.filename}</span>
          <span className="text-[13px] truncate shrink-0 max-w-[45%]" style={{ color: 'rgba(255,255,255,0.35)' }}>
            {file.gallery_name || 'No gallery'}
          </span>
        </div>
        <div data-hswipe className="flex gap-1.5 mt-2 overflow-x-auto pb-1 -mx-4 px-4" style={{ scrollbarWidth: 'none' }}>
          {creators.length === 0 && (
            <span className="shrink-0 px-3 py-1.5 rounded-full text-[13px]"
                  style={{ background: 'color-mix(in srgb, var(--c-amber) 15%, transparent)', color: '#E0B26A' }}>
              No creator yet
            </span>
          )}
          {creators.map(c => {
            const focused = state?.focus?.id === c.id
            const ownFile = fileIds.includes(c.id)
            return (
              <span key={c.id} className="shrink-0 flex items-center gap-1 pl-3 pr-1 py-1 rounded-full text-[14px]"
                    style={{ background: focused ? 'color-mix(in srgb, var(--c-pink) 20%, transparent)' : 'var(--c-card)',
                             color: focused ? '#F0A3BD' : 'rgba(255,255,255,0.85)' }}>
                {c.name}
                <button onClick={() => setFocus(focused ? null : c.id, c.name)} className="p-2 -my-1 rounded-full active:bg-white/10"
                        aria-label={focused ? 'Stop focusing' : 'Focus on this creator'}>
                  <Crosshair size={16} style={{ opacity: focused ? 1 : 0.55 }} />
                </button>
                {ownFile && (
                  <button onClick={() => removeCreator(c.id)} className="p-1 rounded-full active:bg-white/10" aria-label="Remove creator">
                    <X size={13} style={{ opacity: 0.5 }} />
                  </button>
                )}
              </span>
            )
          })}
          {missingFromLast.length > 0 && (
            <button onClick={() => missingFromLast.forEach(addCreator)}
                    className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[13px]"
                    style={{ background: 'color-mix(in srgb, var(--accent) 18%, transparent)', color: '#B5AFF0' }}>
              <Copy size={13} /> Same as last
            </button>
          )}
          <button onClick={() => setSheet('creator')}
                  className="shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-full text-[13px]"
                  style={{ border: '1px dashed rgba(255,255,255,0.2)', color: 'rgba(255,255,255,0.6)' }}>
            <Plus size={14} /> Creator
          </button>
        </div>
      </div>

      {/* Rating */}
      <div className="flex justify-center gap-0.5 mt-2.5 px-2">
        {Array.from({ length: 10 }, (_, i) => i + 1).map(n => (
          <button key={n} onClick={() => patch({ rating: draft.rating === n ? 0 : n })}
                  className="p-1 active:scale-90 transition-transform" aria-label={`Rate ${n}`}>
            <Star size={27} color="var(--c-amber)" fill={draft.rating >= n ? 'var(--c-amber)' : 'none'} strokeWidth={1.6} />
          </button>
        ))}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 px-4 mt-3">
        <button onClick={undo} disabled={!historyLen || busy}
                className="p-3 rounded-full disabled:opacity-30" style={{ background: 'var(--c-card)' }} aria-label="Undo">
          <Undo2 size={20} />
        </button>
        <button onClick={later} disabled={busy}
                className="flex items-center gap-2 px-4 py-3 rounded-full text-[15px] disabled:opacity-50"
                style={{ background: 'var(--c-card)', color: 'rgba(255,255,255,0.7)' }}>
          <Clock size={17} /> Not now
        </button>
        <button onClick={saveAndNext} disabled={busy}
                className="flex-1 flex items-center justify-center gap-2 py-3 rounded-full text-[15px] font-semibold disabled:opacity-50"
                style={{ background: 'color-mix(in srgb, var(--c-green) 25%, transparent)', color: '#6FD3AE',
                         border: '1px solid color-mix(in srgb, var(--c-green) 45%, transparent)' }}>
          Next <ArrowRight size={17} />
        </button>
      </div>

      <div className="flex flex-col items-center mt-4 text-[12px]" style={{ color: 'rgba(255,255,255,0.3)' }}>
        <span>Details</span>
        <ChevronDown size={16} />
      </div>

      {/* ── Details (optional, below the fold) ── */}
      <div className="px-4 mt-3 pb-[calc(var(--sab)+32px)] flex flex-col gap-5">
        <section>
          <SectionLabel>Tags</SectionLabel>
          <div className="flex flex-wrap gap-1.5">
            {draft.tags.map(name => (
              <span key={name} className="flex items-center gap-1 pl-3 pr-1 py-1 rounded-full text-[14px]"
                    style={{ background: 'var(--c-card)', color: 'rgba(255,255,255,0.8)' }}>
                {name}
                <button onClick={() => patch({ tags: draft.tags.filter(t => t !== name) })}
                        className="p-1 rounded-full active:bg-white/10" aria-label={`Remove ${name}`}>
                  <X size={13} style={{ opacity: 0.5 }} />
                </button>
              </span>
            ))}
            <button onClick={() => setSheet('tag')}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-full text-[13px]"
                    style={{ border: '1px dashed rgba(255,255,255,0.2)', color: 'rgba(255,255,255,0.6)' }}>
              <Plus size={14} /> Tag
            </button>
          </div>
        </section>

        <section>
          <SectionLabel>Notes</SectionLabel>
          <textarea value={draft.notes} onChange={e => patch({ notes: e.target.value })}
                    placeholder="Add a note" rows={3}
                    className="w-full rounded-xl p-3 text-[15px] outline-none resize-none"
                    style={{ background: 'var(--c-card)', color: 'rgba(255,255,255,0.9)' }} />
        </section>

        <section>
          <SectionLabel>More</SectionLabel>
          {confirmDelete ? (
            <div className="rounded-xl p-3 flex flex-col gap-3"
                 style={{ background: 'color-mix(in srgb, var(--c-pink) 12%, transparent)', border: '1px solid color-mix(in srgb, var(--c-pink) 40%, transparent)' }}>
              <div className="text-[14px]" style={{ color: '#F0A3BD' }}>
                Delete <b>{file.filename}</b> from disk? This can't be undone.
              </div>
              <div className="flex gap-2">
                <button onClick={() => setConfirmDelete(false)} className="flex-1 py-2.5 rounded-full text-[14px]" style={{ background: 'rgba(255,255,255,0.08)' }}>Cancel</button>
                <button onClick={deleteFile} disabled={busy} className="flex-1 py-2.5 rounded-full text-[14px] font-semibold disabled:opacity-50" style={{ background: 'var(--c-pink)' }}>Delete</button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {file.gallery_id && (
                <MoreButton icon={<FolderOpen size={16} />} onClick={() => nav(`/gallery/${file.gallery_id}`)}>Open gallery</MoreButton>
              )}
              <MoreButton icon={<Wand2 size={16} />} onClick={aiTag}>AI tag</MoreButton>
              <MoreButton icon={<Trash2 size={16} />} onClick={() => setConfirmDelete(true)} danger>Delete</MoreButton>
            </div>
          )}
        </section>
      </div>

      <CreatorSheet open={sheet === 'creator'} onClose={() => setSheet(null)}
                    taken={creators.map(c => c.id)} onPick={c => { addCreator(c); setSheet(null) }} />
      <CreatorSheet open={sheet === 'focus'} onClose={() => setSheet(null)} title="Focus the run on…"
                    taken={[]} onPick={c => { setSheet(null); setFocus(c.id, c.name) }} />
      <TagSheet open={sheet === 'tag'} onClose={() => setSheet(null)}
                taken={draft.tags} onPick={name => patch({ tags: [...draft.tags, name] })} />
    </div>
  )
}

function SectionLabel({ children }) {
  return <div className="text-[12px] uppercase tracking-wide mb-2" style={{ color: 'rgba(255,255,255,0.35)' }}>{children}</div>
}

function MoreButton({ icon, children, onClick, danger }) {
  return (
    <button onClick={onClick} className="flex items-center gap-2 px-4 py-2.5 rounded-full text-[14px]"
            style={{ background: danger ? 'color-mix(in srgb, var(--c-pink) 14%, transparent)' : 'var(--c-card)',
                     color: danger ? 'var(--c-pink)' : 'rgba(255,255,255,0.75)' }}>
      {icon} {children}
    </button>
  )
}

// ── Pickers ─────────────────────────────────────────────────────────────────
function Sheet({ open, onClose, title, query, setQuery, children }) {
  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[60] flex flex-col justify-end">
          <motion.div className="absolute inset-0 bg-black/60" onClick={onClose}
                      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} />
          <motion.div className="relative rounded-t-2xl flex flex-col" style={{ background: 'var(--c-surface)', height: '75vh' }}
                      initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} transition={{ duration: 0.26, ease: EASE }}>
            <div className="flex justify-center pt-3 pb-1"><div className="h-1.5 w-10 rounded-full bg-white/20" /></div>
            <div className="px-5 py-2 text-base font-medium" style={{ color: 'rgba(255,255,255,0.6)' }}>{title}</div>
            <div className="px-4 pb-2">
              <div className="flex items-center gap-2 px-3 rounded-xl" style={{ background: 'var(--c-card)' }}>
                <Search size={18} style={{ color: 'rgba(255,255,255,0.4)' }} />
                <input autoFocus value={query} onChange={e => setQuery(e.target.value)} placeholder="Search"
                       className="flex-1 py-2.5 bg-transparent outline-none text-[16px]" />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto pb-[calc(var(--sab)+8px)]">{children}</div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  )
}

function SheetRow({ children, onClick, accent }) {
  return (
    <button onClick={onClick} className="w-full flex items-center gap-3 px-5 py-3.5 text-left text-[16px] active:bg-white/5"
            style={{ color: accent ? 'var(--accent)' : 'rgba(255,255,255,0.9)' }}>
      {children}
    </button>
  )
}

function CreatorSheet({ open, onClose, taken, onPick, title }) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState([])
  useEffect(() => { if (open) setQ('') }, [open])
  useEffect(() => {
    if (!open) return
    let alive = true
    const term = q.trim()
    const t = setTimeout(() => {
      const req = term ? creatorsApi.list({ search: term, limit: 30 }) : creatorsApi.favorites()
      req.then(r => { if (alive) setResults(Array.isArray(r.data) ? r.data : (r.data?.items || [])) }).catch(() => {})
    }, term ? 200 : 0)
    return () => { alive = false; clearTimeout(t) }
  }, [q, open])
  const list = results.filter(c => !taken.includes(c.id))
  return (
    <Sheet open={open} onClose={onClose} title={title || (q.trim() ? 'Creators' : 'Favorite creators')} query={q} setQuery={setQ}>
      {list.map(c => (
        <SheetRow key={c.id} onClick={() => onPick(c)}>
          <span className="flex-1 truncate">{c.name}</span>
          <span className="text-[13px]" style={{ color: 'rgba(255,255,255,0.3)' }}>{c.creator_type}</span>
        </SheetRow>
      ))}
      {!list.length && <div className="px-5 py-6 text-center text-[15px]" style={{ color: 'rgba(255,255,255,0.35)' }}>Nothing found</div>}
    </Sheet>
  )
}

let tagCache = null
function TagSheet({ open, onClose, taken, onPick }) {
  const [q, setQ] = useState('')
  const [all, setAll] = useState(tagCache || [])
  useEffect(() => { if (open) setQ('') }, [open])
  useEffect(() => {
    if (!open || tagCache) return
    tagsApi.list().then(r => {
      tagCache = [...(r.data || [])].sort((a, b) => (b.use_count || 0) - (a.use_count || 0))
      setAll(tagCache)
    }).catch(() => {})
  }, [open])
  const term = q.trim().toLowerCase()
  const list = useMemo(() => {
    const free = all.filter(t => !taken.includes(t.name))
    if (!term) return free.slice(0, 40)
    const starts = free.filter(t => t.name.toLowerCase().startsWith(term))
    const has = free.filter(t => !t.name.toLowerCase().startsWith(term) && t.name.toLowerCase().includes(term))
    return [...starts, ...has].slice(0, 40)
  }, [all, taken, term])
  const exact = all.some(t => t.name.toLowerCase() === term) || taken.some(t => t.toLowerCase() === term)
  return (
    <Sheet open={open} onClose={onClose} title="Add tags" query={q} setQuery={setQ}>
      {term && !exact && (
        <SheetRow accent onClick={() => { onPick(q.trim()); setQ('') }}>
          <Plus size={18} /> Create “{q.trim()}”
        </SheetRow>
      )}
      {list.map(t => (
        <SheetRow key={t.id} onClick={() => { onPick(t.name); setQ('') }}>
          <span className="flex-1 truncate">{t.name}</span>
          <span className="text-[13px]" style={{ color: 'rgba(255,255,255,0.3)' }}>{(t.use_count || 0).toLocaleString()}</span>
        </SheetRow>
      ))}
    </Sheet>
  )
}

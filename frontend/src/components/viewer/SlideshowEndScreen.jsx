/**
 * <SlideshowEndScreen /> — the "what now?" screen a slideshow lands on when it
 * reaches the end of a gallery.
 *
 * Rendered INSIDE the image viewer, as if it were one more slide. It is not a
 * route: pressing Back or Escape drops you onto the last image again, and
 * leaving the viewer returns to the gallery exactly as before.
 *
 * Every tile is reachable with number keys 1–6, and an idle countdown picks one
 * for you, so a session never needs a hand on the mouse to keep going.
 */
import React, { useState, useEffect, useCallback, useRef } from 'react'
import { motion } from 'framer-motion'
import { Users, Shuffle, Sparkle, Heart, ListPlus, RotateCcw } from 'lucide-react'
import toast from 'react-hot-toast'
import { galleriesApi, imagesApi, playlistsApi } from '../../lib/api'
import { useT } from '../../i18n'

// Seconds of inactivity before the highlighted tile fires on its own.
const AUTOPICK_SECONDS = 15
const AUTOPICK_TILE    = 3   // "More like this"

function Tile({ index, icon: Icon, label, sublabel, onClick, busy, highlighted }) {
  return (
    <motion.button
      onClick={onClick}
      disabled={busy}
      whileHover={{ scale: busy ? 1 : 1.03 }}
      whileTap={{ scale: busy ? 1 : 0.98 }}
      className="relative flex flex-col items-center justify-center gap-3 rounded-2xl cursor-pointer disabled:opacity-50"
      style={{
        padding: '28px 18px',
        minHeight: 160,
        background: highlighted ? 'rgba(127,119,221,0.18)' : 'rgba(255,255,255,0.04)',
        border: `1px solid ${highlighted ? 'var(--c-accent)' : 'rgba(255,255,255,0.09)'}`,
        backdropFilter: 'blur(10px)',
      }}>
      {/* Number badge — the whole point is that you press the key, not click */}
      <span
        className="absolute top-3 left-3 flex items-center justify-center rounded-lg font-mono"
        style={{
          width: 26, height: 26, fontSize: 16,
          background: highlighted ? 'var(--c-accent)' : 'rgba(255,255,255,0.08)',
          color: highlighted ? '#fff' : 'rgba(255,255,255,0.5)',
        }}>
        {index}
      </span>

      <Icon size={38} style={{ color: highlighted ? '#CECBF6' : 'rgba(255,255,255,0.6)' }} />
      <div className="text-center">
        <div style={{ fontSize: 18, color: 'rgba(255,255,255,0.88)', fontWeight: 600 }}>{label}</div>
        {sublabel && (
          <div style={{ fontSize: 16, color: 'rgba(255,255,255,0.35)', marginTop: 4 }}>{sublabel}</div>
        )}
      </div>
    </motion.button>
  )
}

export default function SlideshowEndScreen({
  galleryId,
  galleryName,
  galleryCreators = [],
  watchedImages = [],
  onPlayQueue,      // (images, label) — swap these into the viewer and keep playing
  onReplay,         // restart the gallery from the first image
  onDismiss,        // back to the last image, screen closed
}) {
  const [busy, setBusy]           = useState(null)   // tile index currently loading
  const [countdown, setCountdown] = useState(AUTOPICK_SECONDS)
  const [autoPick, setAutoPick]   = useState(true)
  const t = useT()

  const creator = galleryCreators[0] || null

  // Loads a gallery's images straight into the current viewer rather than
  // navigating — keeps you in the same place, mid-session.
  const playGallery = useCallback(async (gallery, label, creators = []) => {
    if (!gallery?.id) { toast(t('Nothing found')); return false }
    const { data } = await galleriesApi.images(gallery.id, { limit: 500 })
    const images = (data || []).filter(im => !im.is_video)
    if (!images.length) { toast(t('That gallery has no photos')); return false }
    // Pass the source gallery along so a second trip through this screen
    // recommends from what you just watched, not where you started.
    onPlayQueue(images, gallery.name || label, gallery.id, creators)
    return true
  }, [onPlayQueue, t])

  // ── Tile actions ───────────────────────────────────────────────────────────
  const actions = {
    1: async () => {
      if (!creator) { toast(t('This gallery has no creator set')); return }
      const { data } = await galleriesApi.list({
        creator_id: creator.id, sort_by: 'random', limit: 12,
      })
      const other = (data || []).filter(g => g.id !== galleryId)
      if (!other.length) { toast(t('No other galleries from this creator')); return }
      await playGallery(other[0], creator.name, other[0].creators || [creator])
    },

    2: async () => {
      const { data } = await galleriesApi.random()
      await playGallery(data, t('Random gallery'), data?.creators || [])
    },

    3: async () => {
      if (!galleryId) { toast(t('No gallery to match against')); return }
      const { data } = await galleriesApi.moreLikeThis(galleryId, 3)
      const match = (data?.matches || [])[0]
      if (!match) { toast(t('Nothing similar found')); return }
      const ok = await playGallery(match, match.name, match.creators || [])
      if (ok && data.signature?.length) {
        const how = data.match_strength === 'random'
          ? t('Random pick — nothing matched')
          : `${t('Matched on')} ${data.signature.slice(0, 3).join(', ')}`
        toast(how)
      }
    },

    4: async () => {
      const { data } = await imagesApi.list({
        favorite: true, is_video: false, sort_by: 'random', limit: 60,
      })
      if (!data?.length) { toast(t('You have no favourites yet')); return }
      onPlayQueue(data, t('Your favourites'))
    },

    5: async () => {
      if (!watchedImages.length) { toast(t('Nothing to save')); return }
      const name = `${galleryName || t('Slideshow')} — ${new Date().toLocaleDateString()}`
      const { data: playlist } = await playlistsApi.create({ name })
      // Sequential on purpose: the API takes one image per call, and firing
      // hundreds in parallel is a good way to make the local server unhappy.
      for (const img of watchedImages) {
        await playlistsApi.addImage(playlist.id, img.id).catch(() => {})
      }
      toast.success(`${t('Saved')} · ${watchedImages.length} ${t('photos')}`)
    },

    6: async () => onReplay(),
  }

  const run = useCallback(async (index) => {
    if (busy) return
    setAutoPick(false)
    setBusy(index)
    try {
      await actions[index]()
    } catch (_) {
      toast.error(t('That did not work'))
    } finally {
      setBusy(null)
    }
  }, [busy, actions, t])

  // Keep `run` reachable from the key handler without re-binding every render.
  const runRef = useRef(run)
  useEffect(() => { runRef.current = run })

  // Number keys 1–6, plus Escape/Backspace to dismiss.
  useEffect(() => {
    function onKey(e) {
      if (e.target?.tagName === 'INPUT' || e.target?.tagName === 'TEXTAREA') return
      if (e.key === 'Escape' || e.key === 'Backspace') {
        e.preventDefault(); e.stopPropagation()
        onDismiss()
        return
      }
      const n = parseInt(e.key, 10)
      if (n >= 1 && n <= 6) {
        e.preventDefault(); e.stopPropagation()
        runRef.current(n)
      }
    }
    // Capture phase so the viewer's own Escape/arrow handling doesn't run first.
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onDismiss])

  // Idle auto-pick. Any tile press cancels it (via setAutoPick in `run`), as
  // does clicking the toggle.
  useEffect(() => {
    if (!autoPick) return
    // A mixed queue (favourites) has no source gallery to match against, so
    // auto-pick falls back to a random gallery rather than erroring out.
    if (countdown <= 0) { runRef.current(galleryId ? AUTOPICK_TILE : 2); return }
    const id = setTimeout(() => setCountdown(c => c - 1), 1000)
    return () => clearTimeout(id)
  }, [autoPick, countdown, galleryId])

  return (
    // Deliberately NOT a fade from opacity 0. requestAnimationFrame is throttled
    // in background tabs and skipped entirely under reduced-motion, which would
    // leave this screen invisible while it still owned the keyboard. It animates
    // on transform only — worst case it appears instantly, never invisibly.
    <motion.div
      initial={{ y: 10 }}
      animate={{ y: 0 }}
      transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
      className="absolute inset-0 z-30 flex flex-col items-center justify-center px-8"
      // Near-solid rather than a light scrim: the tiles have to stay readable
      // over any photo, including bright ones.
      style={{ background: 'rgba(6,6,6,0.975)' }}>

      <div className="text-center mb-8">
        <div style={{ fontSize: 16, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
          {t('End of')} {galleryName}
        </div>
        <div style={{ fontSize: 30, fontWeight: 600, color: 'rgba(255,255,255,0.9)', marginTop: 6 }}>
          {t('Keep going?')}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4 w-full" style={{ maxWidth: 860 }}>
        <Tile index={1} icon={Users}    label={t('More from')}
              sublabel={creator?.name || t('no creator set')}
              onClick={() => run(1)} busy={busy === 1} highlighted={busy === 1} />
        <Tile index={2} icon={Shuffle}  label={t('Random gallery')}
              sublabel={t('anything in the vault')}
              onClick={() => run(2)} busy={busy === 2} highlighted={busy === 2} />
        <Tile index={3} icon={Sparkle}  label={t('More like this')}
              sublabel={t('matched on tags')}
              onClick={() => run(3)} busy={busy === 3}
              highlighted={busy === 3 || (autoPick && busy === null)} />
        <Tile index={4} icon={Heart}    label={t('Your favourites')}
              sublabel={t('a shuffled run')}
              onClick={() => run(4)} busy={busy === 4} highlighted={busy === 4} />
        <Tile index={5} icon={ListPlus} label={t('Save as playlist')}
              sublabel={`${watchedImages.length} ${t('photos')}`}
              onClick={() => run(5)} busy={busy === 5} highlighted={busy === 5} />
        <Tile index={6} icon={RotateCcw} label={t('Watch again')}
              sublabel={t('from the start')}
              onClick={() => run(6)} busy={busy === 6} highlighted={busy === 6} />
      </div>

      <div className="flex items-center gap-4 mt-8">
        <button
          onClick={() => setAutoPick(a => !a)}
          className="cursor-pointer transition-colors hover:text-white"
          style={{ fontSize: 16, color: autoPick ? '#CECBF6' : 'rgba(255,255,255,0.3)' }}>
          {autoPick
            ? `${t('More like this in')} ${countdown}s · ${t('click to cancel')}`
            : t('Auto-pick off')}
        </button>
        <span style={{ color: 'rgba(255,255,255,0.15)' }}>·</span>
        <button
          onClick={onDismiss}
          className="cursor-pointer transition-colors hover:text-white"
          style={{ fontSize: 16, color: 'rgba(255,255,255,0.3)' }}>
          {t('Back to the gallery')}
        </button>
      </div>
    </motion.div>
  )
}

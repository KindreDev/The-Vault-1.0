import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { X, Star, Heart, ListPlus, Play, Pause, Download, Smartphone, Lock, Layers } from 'lucide-react'
import { galleriesApi, imagesApi, playlistsApi } from '../lib/api.js'
import { imageThumbUrl, imageFileUrl } from '../lib/media.js'
import { enterImmersive, exitImmersive } from '../lib/fullscreen.js'
import { saveImage, setWallpaper, canSetWallpaper } from '../lib/wallpaper.js'
import { useVaultStore } from '../store/vault.js'
import { Spinner } from '../components/ui.jsx'
import BottomSheet from '../components/BottomSheet.jsx'

// Gap between photos so a fast swipe never reveals a sliver of the neighbour —
// you see black between them instead, like a real gallery app.
const GAP = 24

// Fullscreen swipeable viewer. Three sources:
//   • gallery   → /view/:galleryId
//   • playlist  → /playlist/:playlistId/view
//   • single    → /photo/:imageId   (one image, no list context)
//
// Paging is done by hand (a transform on the strip of photos) instead of the
// browser's sideways scroll. Native scroll keeps gliding after a fast flick,
// which made the old viewer skip dozens of photos at once. Here one swipe
// always moves exactly one photo. Pinch / double-tap zoom and the bottom
// thumbnail strip round it out, Samsung-Gallery style.
export default function ImageViewer() {
  const { galleryId, playlistId, imageId } = useParams()
  const [params] = useSearchParams()
  const nav = useNavigate()
  const qc = useQueryClient()
  const addToast = useVaultStore(s => s.addToast)
  const openPlaylistPicker = useVaultStore(s => s.openPlaylistPicker)
  const startIdx = parseInt(params.get('i') || '0', 10)

  const viewport = useRef(null)   // clips the strip
  const track = useRef(null)      // the strip we slide left/right
  const imgRef = useRef(null)     // the currently-shown <img> (for zoom/pan)
  const strip = useRef(null)      // bottom thumbnail rail

  const [idx, setIdx] = useState(imageId ? 0 : startIdx)
  const [chrome, setChrome] = useState(true)
  const [closing, setClosing] = useState(false)   // drives the reverse zoom-out
  const [zoomed, setZoomed] = useState(false)
  const [menu, setMenu] = useState(false)         // long-press save / wallpaper sheet
  const [playing, setPlaying] = useState(false)   // active video play state
  const [vtime, setVtime] = useState(0)
  const [vdur, setVdur] = useState(0)
  const videoRefs = useRef({})                     // id → <video> element
  const scrubbing = useRef(false)                  // true while dragging the bar

  const queryKey = playlistId ? ['playlist-detail', playlistId]
                 : imageId    ? ['photo-view', imageId]
                 :              ['gallery-images', galleryId]
  const { data, isLoading } = useQuery({
    queryKey,
    // NOTE: the playlist branch returns the FULL detail object (not just the
    // images array) so it shares an identical cache shape with PlaylistView,
    // which uses the same ['playlist-detail', id] key.
    queryFn: () => playlistId
      ? playlistsApi.detail(playlistId).then(r => r.data)
      : imageId
        ? imagesApi.get(imageId).then(r => [r.data])
        : galleriesApi.images(galleryId, { limit: 1000 }).then(r => r.data || []),
  })
  const images = Array.isArray(data) ? data : (data?.images || [])

  // Refs the touch handlers read so they never see stale values.
  const idxRef = useRef(idx)
  const imagesRef = useRef(images)
  useEffect(() => { idxRef.current = idx }, [idx])
  useEffect(() => { imagesRef.current = images }, [images])

  // Real measured page width (the viewport), kept in a ref so touch handlers
  // read a fresh value. `step` is one page plus the gap between pages.
  const [pageW, setPageW] = useState(typeof window !== 'undefined' ? window.innerWidth : 360)
  const pageWRef = useRef(pageW)
  useEffect(() => { pageWRef.current = pageW }, [pageW])
  const W = () => pageWRef.current
  const step = () => pageWRef.current + GAP

  // True fullscreen: drop the Android status bar while the viewer is open.
  useEffect(() => { enterImmersive(); return () => { exitImmersive() } }, [])

  // ── Strip + zoom helpers (imperative, so a swipe doesn't re-render every move)
  function setTrack(x, animate) {
    const t = track.current
    if (!t) return
    t.style.transition = animate ? 'transform .26s cubic-bezier(.22,1,.36,1)' : 'none'
    t.style.transform = `translate3d(${x}px,0,0)`
  }
  const zoom = useRef({ scale: 1, tx: 0, ty: 0 })
  function clampZoom() {
    const w = W(), h = window.innerHeight
    const maxX = (w * (zoom.current.scale - 1)) / 2
    const maxY = (h * (zoom.current.scale - 1)) / 2
    zoom.current.tx = Math.max(-maxX, Math.min(maxX, zoom.current.tx))
    zoom.current.ty = Math.max(-maxY, Math.min(maxY, zoom.current.ty))
  }
  function applyImg(animate) {
    const el = imgRef.current
    if (!el) return
    const z = zoom.current
    el.style.transition = animate ? 'transform .25s ease' : 'none'
    el.style.transform = `translate3d(${z.tx}px,${z.ty}px,0) scale(${z.scale})`
  }
  function resetZoom(animate) {
    zoom.current = { scale: 1, tx: 0, ty: 0 }
    applyImg(animate)
    setZoomed(false)
  }

  // Jump straight to a photo (bottom strip taps, double-tap landing).
  function jump(i) {
    const t = Math.max(0, Math.min(imagesRef.current.length - 1, i))
    resetZoom(false)
    idxRef.current = t
    setIdx(t)
    setTrack(-t * step(), true)
  }

  // Position the strip once images are known, and on rotation/resize.
  useEffect(() => {
    if (!images.length) return
    const w = viewport.current?.clientWidth || window.innerWidth
    pageWRef.current = w; setPageW(w)
    const start = imageId ? 0 : startIdx
    idxRef.current = start
    setIdx(start)
    setTrack(-start * (w + GAP), false)
    const onResize = () => {
      const nw = viewport.current?.clientWidth || window.innerWidth
      pageWRef.current = nw; setPageW(nw)
      setTrack(-idxRef.current * (nw + GAP), false)
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [images.length])

  // Keep the active thumbnail centered in the bottom rail.
  useEffect(() => {
    const el = strip.current?.children?.[idx]
    if (el) el.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' })
  }, [idx, images.length])

  const current = images?.[idx]
  useEffect(() => { if (current) imagesApi.view(current.id).catch(() => {}) }, [current?.id])

  // Play only the photo you're on; pause everything else. Try to autostart the
  // active video (the tap that opened the viewer counts as the needed gesture).
  useEffect(() => {
    const activeEl = videoRefs.current[current?.id]
    Object.entries(videoRefs.current).forEach(([id, el]) => {
      if (!el) return
      if (current && String(current.id) === id && current.is_video) {
        el.currentTime = 0
        el.play().then(() => setPlaying(true)).catch(() => setPlaying(false))
      } else {
        el.pause()
      }
    })
    if (current?.is_video) {
      setVtime(0)
      // Read the duration straight off the element — the loadedmetadata event
      // may have already fired (cached video) before our listener attached, so
      // relying on the event alone leaves vdur at 0 and breaks the scrubber.
      const d = activeEl?.duration
      setVdur(Number.isFinite(d) && d > 0 ? d : 0)
    } else {
      setPlaying(false); setVtime(0); setVdur(0)
    }
  }, [current?.id])

  // Catch the duration whenever the active video reports it (metadata load,
  // duration change, or can-play) — covers every timing case.
  function captureDur(e) {
    const d = e.target.duration
    if (Number.isFinite(d) && d > 0) setVdur(d)
  }
  function togglePlay() {
    const el = videoRefs.current[current?.id]
    if (!el) return
    if (el.paused) el.play(); else el.pause()
  }
  function seek(t) {
    const el = videoRefs.current[current?.id]
    // Ignore seeks until we actually know the duration, otherwise a stray value
    // of 0 (slider pinned at min) would snap the video back to the start.
    if (!el || !vdur || !Number.isFinite(t)) return
    el.currentTime = t; setVtime(t)
  }
  const fmt = (s) => { s = Math.floor(s || 0); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` }

  // ── Touch gestures (native listeners so we can block the browser's own scroll)
  useEffect(() => {
    const v = viewport.current
    if (!v) return
    const g = { mode: null, sx: 0, sy: 0, dx: 0, dist0: 0, scale0: 1, tx0: 0, ty0: 0, moved: false, lastTap: 0, tapTimer: 0, lpTimer: 0, longPressed: false }
    const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY)
    const cancelLongPress = () => { if (g.lpTimer) { clearTimeout(g.lpTimer); g.lpTimer = 0 } }

    const onStart = (e) => {
      g.moved = false
      cancelLongPress()
      if (e.touches.length === 2) {
        g.mode = 'pinch'
        g.dist0 = dist(e.touches)
        g.scale0 = zoom.current.scale
      } else if (e.touches.length === 1) {
        const t = e.touches[0]
        g.sx = t.clientX; g.sy = t.clientY
        if (zoom.current.scale > 1.02) { g.mode = 'pan'; g.tx0 = zoom.current.tx; g.ty0 = zoom.current.ty }
        else {
          g.mode = 'page'; g.dx = 0
          // Press and hold (not zoomed, not moving) opens the save / wallpaper
          // menu for a photo — videos can't be saved or set as wallpaper.
          g.longPressed = false
          g.lpTimer = setTimeout(() => {
            g.lpTimer = 0
            const cur = imagesRef.current[idxRef.current]
            if (cur && !cur.is_video) {
              g.longPressed = true
              if (navigator.vibrate) navigator.vibrate(15)
              setMenu(true)
            }
          }, 450)
        }
      }
    }
    const onMove = (e) => {
      if (!g.mode) return
      e.preventDefault()
      cancelLongPress()
      if (g.mode === 'pinch' && e.touches.length >= 2) {
        zoom.current.scale = Math.max(1, Math.min(5, g.scale0 * dist(e.touches) / g.dist0))
        clampZoom(); applyImg(false); g.moved = true
      } else if (g.mode === 'pan') {
        const t = e.touches[0]
        zoom.current.tx = g.tx0 + (t.clientX - g.sx)
        zoom.current.ty = g.ty0 + (t.clientY - g.sy)
        clampZoom(); applyImg(false)
        if (Math.hypot(t.clientX - g.sx, t.clientY - g.sy) > 5) g.moved = true
      } else if (g.mode === 'page') {
        const t = e.touches[0]
        let dx = t.clientX - g.sx
        const last = imagesRef.current.length - 1
        // Rubber-band at the two ends so it feels bounded, not stuck.
        if ((idxRef.current === 0 && dx > 0) || (idxRef.current === last && dx < 0)) dx *= 0.35
        g.dx = dx
        setTrack(-idxRef.current * step() + dx, false)
        if (Math.abs(dx) > 5) g.moved = true
      }
    }
    const onEnd = (e) => {
      if (!g.mode) return
      cancelLongPress()
      const w = W()
      if (g.mode === 'page') {
        let target = idxRef.current
        // One swipe, one photo: past ~18% of the screen flips a single page,
        // regardless of how fast the flick was.
        if (g.dx < -w * 0.18 && idxRef.current < imagesRef.current.length - 1) target++
        else if (g.dx > w * 0.18 && idxRef.current > 0) target--
        idxRef.current = target
        setIdx(target)
        setTrack(-target * step(), true)
      } else if (g.mode === 'pinch' || g.mode === 'pan') {
        if (zoom.current.scale <= 1.02) resetZoom(true)
        else setZoomed(true)
      }
      // Tap handling: single tap toggles the bars, double tap zooms.
      // A long-press that opened the menu is neither a tap nor a swipe.
      if (!g.moved && !g.longPressed && e.touches.length === 0) {
        const now = Date.now()
        if (now - g.lastTap < 280) {
          clearTimeout(g.tapTimer); g.lastTap = 0
          const cur = imagesRef.current[idxRef.current]
          if (cur && !cur.is_video) {
            if (zoom.current.scale > 1.02) resetZoom(true)
            else { zoom.current.scale = 2.5; clampZoom(); applyImg(true); setZoomed(true) }
          }
        } else {
          g.lastTap = now
          g.tapTimer = setTimeout(() => setChrome(c => !c), 280)
        }
      }
      g.mode = null
    }

    v.addEventListener('touchstart', onStart, { passive: false })
    v.addEventListener('touchmove', onMove, { passive: false })
    v.addEventListener('touchend', onEnd, { passive: false })
    return () => {
      v.removeEventListener('touchstart', onStart)
      v.removeEventListener('touchmove', onMove)
      v.removeEventListener('touchend', onEnd)
    }
  }, [images.length])

  // Start the shrink-away animation; actual navigation happens once it finishes.
  function goBack() { setClosing(true) }
  function finishClose() {
    if (!closing) return
    if (window.history.length > 1) nav(-1)
    else nav('/galleries')
  }
  async function rate(r) {
    if (!current) return
    try { await imagesApi.rate(current.id, r); addToast('Rated', 'xp'); qc.invalidateQueries({ queryKey }) }
    catch {}
  }
  async function toggleFav() {
    if (!current) return
    try { await imagesApi.favorite(current.id, !current.is_favorite); qc.invalidateQueries({ queryKey }) }
    catch {}
  }
  async function doSave() {
    if (!current) return
    addToast('Saving…', 'info')
    try {
      const how = await saveImage(imageFileUrl(current))
      addToast(how === 'saved' ? 'Saved to your photos' : how === 'shared' ? 'Shared' : 'Downloaded', 'xp')
    } catch { addToast('Could not save image', 'info') }
  }
  async function doWallpaper(target) {
    if (!current) return
    addToast('Setting wallpaper…', 'info')
    try {
      await setWallpaper(imageFileUrl(current), target)
      addToast('Wallpaper set', 'xp')
    } catch { addToast('Could not set wallpaper', 'info') }
  }
  const menuActions = current ? [
    { label: 'Save to device', icon: <Download size={22} />, onClick: doSave },
    ...(canSetWallpaper() ? [
      { label: 'Set as home screen', icon: <Smartphone size={22} />, onClick: () => doWallpaper('home') },
      { label: 'Set as lock screen', icon: <Lock size={22} />, onClick: () => doWallpaper('lock') },
      { label: 'Set as both screens', icon: <Layers size={22} />, onClick: () => doWallpaper('both') },
    ] : []),
  ] : []

  return (
    <motion.div className="fixed inset-0 z-50 bg-black overflow-hidden"
      initial={{ opacity: 0, scale: 0.85 }}
      animate={closing ? { opacity: 0, scale: 0.85 } : { opacity: 1, scale: 1 }}
      transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
      onAnimationComplete={finishClose}>

      <div ref={viewport} className="absolute inset-0 overflow-hidden" style={{ touchAction: 'none' }}>
        <div ref={track} className="flex h-full" style={{ willChange: 'transform', gap: GAP }}>
          {images?.map((img, i) => (
            <div key={img.id}
                 className="shrink-0 h-full flex items-center justify-center"
                 style={{ width: pageW }}>
              {img.is_video ? (
                <video ref={el => { if (el) videoRefs.current[img.id] = el }}
                       src={imageFileUrl(img)} playsInline loop preload="metadata"
                       poster={imageThumbUrl(img)} className="max-w-full max-h-full"
                       onTimeUpdate={i === idx ? e => { if (!scrubbing.current) setVtime(e.target.currentTime) } : undefined}
                       onLoadedMetadata={i === idx ? captureDur : undefined}
                       onDurationChange={i === idx ? captureDur : undefined}
                       onCanPlay={i === idx ? captureDur : undefined}
                       onPlay={i === idx ? () => setPlaying(true) : undefined}
                       onPause={i === idx ? () => setPlaying(false) : undefined} />
              ) : (
                <img ref={i === idx ? imgRef : undefined}
                     src={Math.abs(i - idx) <= 1 ? imageFileUrl(img) : imageThumbUrl(img)}
                     alt="" className="max-w-full max-h-full object-contain"
                     style={{ willChange: 'transform' }} />
              )}
            </div>
          ))}
        </div>
      </div>

      {isLoading && <Spinner />}

      {/* Center play / pause — videos only, shown with the bars */}
      {current?.is_video && chrome && (
        <button onClick={togglePlay}
                className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full flex items-center justify-center"
                style={{ width: 72, height: 72, background: 'rgba(0,0,0,0.45)' }}>
          {playing ? <Pause size={34} color="#fff" fill="#fff" /> : <Play size={34} color="#fff" fill="#fff" />}
        </button>
      )}

      {/* Top bar */}
      <div className={`absolute top-0 left-0 right-0 flex items-center justify-between px-3 transition-opacity ${chrome ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
           style={{ paddingTop: 'calc(var(--sat) + 8px)', paddingBottom: 12, background: 'linear-gradient(to bottom, rgba(0,0,0,0.6), transparent)' }}>
        <button onClick={goBack} className="p-2"><X size={26} color="#fff" /></button>
        <span className="text-[15px] text-white/80">{idx + 1} / {images?.length || 0}</span>
        <div className="flex">
          <button onClick={() => current && openPlaylistPicker([current.id])} className="p-2">
            <ListPlus size={24} color="#fff" />
          </button>
          <button onClick={toggleFav} className="p-2">
            <Heart size={24} color="#fff" fill={current?.is_favorite ? 'var(--c-pink)' : 'none'} />
          </button>
        </div>
      </div>

      {/* Bottom: thumbnail rail + 10-star rating */}
      <div className={`absolute bottom-0 left-0 right-0 flex flex-col items-stretch gap-3 transition-opacity ${chrome ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
           style={{ paddingBottom: 'calc(var(--sab) + 14px)', paddingTop: 20, background: 'linear-gradient(to top, rgba(0,0,0,0.7), transparent)' }}>
        {current?.is_video && (
          <div className="flex items-center gap-2 px-4">
            <span className="text-[16px] text-white/80 tabular-nums">{fmt(vtime)}</span>
            <input type="range" min={0} max={vdur || 0} step="0.1"
                   value={Math.min(vtime, vdur || 0)}
                   onPointerDown={() => { scrubbing.current = true }}
                   onPointerUp={() => { scrubbing.current = false }}
                   onTouchStart={() => { scrubbing.current = true }}
                   onTouchEnd={() => { scrubbing.current = false }}
                   onChange={e => { setVtime(parseFloat(e.target.value)); seek(parseFloat(e.target.value)) }}
                   className="flex-1 accent-[var(--accent)]" />
            <span className="text-[16px] text-white/80 tabular-nums">{fmt(vdur)}</span>
          </div>
        )}
        {images.length > 1 && (
          <div ref={strip} className="flex items-center gap-1.5 px-3 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
            {images.map((img, i) => (
              <button key={img.id} onClick={() => jump(i)} className="shrink-0">
                <img src={imageThumbUrl(img)} alt=""
                     className="object-cover rounded transition-all"
                     style={{
                       height: i === idx ? 52 : 40,
                       width: i === idx ? 40 : 30,
                       opacity: i === idx ? 1 : 0.5,
                       outline: i === idx ? '2px solid var(--accent)' : 'none',
                       outlineOffset: 1,
                     }} />
              </button>
            ))}
          </div>
        )}
        <div className="flex items-center justify-center gap-0.5 px-4">
          {Array.from({ length: 10 }, (_, i) => i + 1).map(n => (
            <button key={n} onClick={() => rate((current?.rating || 0) === n ? 0 : n)} className="p-0.5">
              <Star size={22} color="var(--c-amber)" fill={(current?.rating || 0) >= n ? 'var(--c-amber)' : 'none'} />
            </button>
          ))}
        </div>
      </div>

      <BottomSheet open={menu} onClose={() => setMenu(false)}
                   title="Save image" actions={menuActions} />
    </motion.div>
  )
}

import { useEffect, useRef, useState, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useParams, useNavigate } from 'react-router-dom'
import { ChevronLeft, Play, Pause, Volume2, VolumeX, Gauge, Eye, Star,
         RotateCcw, RotateCw, SkipForward, SkipBack, Repeat } from 'lucide-react'
import { imagesApi, galleriesApi } from '../lib/api.js'
import { imageFileUrl, imageThumbUrl } from '../lib/media.js'
import { useVaultStore } from '../store/vault.js'
import { Spinner } from '../components/ui.jsx'

const SPEEDS = [1, 1.25, 1.5, 2, 0.5]

function fmt(s) {
  if (!s || !isFinite(s)) return '0:00'
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, '0')}`
}

// A sleek, Plex-style fullscreen video player with custom theme-aware controls.
export default function VideoPlayer() {
  const { imageId } = useParams()
  const nav = useNavigate()
  const qc = useQueryClient()
  const addToast = useVaultStore(s => s.addToast)
  const openPlaylistPicker = useVaultStore(s => s.openPlaylistPicker)
  const vid = useRef(null)
  const hideTimer = useRef(null)

  const [playing, setPlaying] = useState(false)
  const [cur, setCur] = useState(0)
  const [dur, setDur] = useState(0)
  const [muted, setMuted] = useState(false)
  const [volume, setVolume] = useState(1)
  const [speedIdx, setSpeedIdx] = useState(0)
  const [loop, setLoop] = useState(false)
  const [chrome, setChrome] = useState(true)

  const { data: img, isLoading } = useQuery({
    queryKey: ['image', imageId],
    queryFn: () => imagesApi.get(imageId).then(r => r.data),
  })

  // Sibling files in the same gallery — drives the "next" button.
  const { data: siblings } = useQuery({
    queryKey: ['gallery-images', img?.gallery_id],
    queryFn: () => galleriesApi.images(img.gallery_id, { limit: 1000 }).then(r => r.data || []),
    enabled: !!img?.gallery_id,
  })

  const sibIdx = siblings?.length ? siblings.findIndex(s => s.id === Number(imageId)) : -1
  const nextItem = sibIdx >= 0 && sibIdx < siblings.length - 1 ? siblings[sibIdx + 1] : null
  const prevItem = sibIdx > 0 ? siblings[sibIdx - 1] : null

  useEffect(() => { imagesApi.view(imageId).catch(() => {}) }, [imageId])

  // Auto-hide chrome while playing.
  const bumpChrome = useCallback(() => {
    setChrome(true)
    clearTimeout(hideTimer.current)
    hideTimer.current = setTimeout(() => { if (vid.current && !vid.current.paused) setChrome(false) }, 3000)
  }, [])
  useEffect(() => () => clearTimeout(hideTimer.current), [])

  function togglePlay() {
    const v = vid.current
    if (!v) return
    if (v.paused) v.play(); else v.pause()
    bumpChrome()
  }
  function seek(e) {
    const v = vid.current
    if (!v || !dur) return
    const rect = e.currentTarget.getBoundingClientRect()
    const pct = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
    v.currentTime = pct * dur
    bumpChrome()
  }
  function skip(delta) {
    const v = vid.current
    if (v) { v.currentTime = Math.min(dur, Math.max(0, v.currentTime + delta)); bumpChrome() }
  }
  function cycleSpeed() {
    const next = (speedIdx + 1) % SPEEDS.length
    setSpeedIdx(next)
    if (vid.current) vid.current.playbackRate = SPEEDS[next]
    bumpChrome()
  }
  function changeVolume(v) {
    setVolume(v)
    if (vid.current) { vid.current.volume = v; vid.current.muted = v === 0 }
    setMuted(v === 0)
    bumpChrome()
  }
  function toggleMute() {
    const m = !muted
    setMuted(m)
    if (vid.current) vid.current.muted = m
    bumpChrome()
  }
  function goTo(item) {
    if (!item) return
    if (item.is_video) nav(`/video/${item.id}`, { replace: true })
    else nav(`/photo/${item.id}`, { replace: true })
  }
  function goBack() {
    if (window.history.length > 1) nav(-1)
    else nav('/galleries')
  }
  async function rate(r) {
    try { await imagesApi.rate(imageId, r); addToast('Rated', 'xp'); qc.invalidateQueries({ queryKey: ['image', imageId] }) }
    catch {}
  }

  if (isLoading) return <div className="fixed inset-0 bg-black"><Spinner /></div>

  const pct = dur ? (cur / dur) * 100 : 0
  const creator = img?.creators?.[0]?.name
  const title = creator || img?.filename || 'Video'

  return (
    <div className="fixed inset-0 z-50 bg-black flex items-center justify-center" onClick={() => (chrome ? setChrome(false) : bumpChrome())}>
      <video
        ref={vid}
        src={imageFileUrl(img)}
        poster={imageThumbUrl(img)}
        playsInline
        autoPlay
        loop={loop}
        onClick={e => { e.stopPropagation(); togglePlay() }}
        onPlay={() => { setPlaying(true); bumpChrome() }}
        onPause={() => { setPlaying(false); setChrome(true) }}
        onTimeUpdate={() => setCur(vid.current?.currentTime || 0)}
        onLoadedMetadata={() => setDur(vid.current?.duration || 0)}
        className="max-w-full max-h-full"
      />

      {/* Top gradient + title */}
      <div className={`absolute top-0 left-0 right-0 flex items-center gap-2 px-3 transition-opacity ${chrome ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
           style={{ paddingTop: 'calc(var(--sat) + 8px)', paddingBottom: 18, background: 'linear-gradient(to bottom, rgba(0,0,0,0.7), transparent)' }}
           onClick={e => e.stopPropagation()}>
        <button onClick={goBack} className="p-2"><ChevronLeft size={28} color="#fff" /></button>
        <div className="flex-1 min-w-0">
          <div className="text-[17px] font-bold text-white truncate">{title}</div>
          <div className="flex items-center gap-3 text-[13px] text-white/60">
            <span className="flex items-center gap-1"><Eye size={14} /> {img?.view_count ?? 0}</span>
          </div>
        </div>
        <button onClick={() => openPlaylistPicker([Number(imageId)])} className="px-3 py-1.5 rounded-full text-[14px] font-semibold"
                style={{ background: 'rgba(255,255,255,0.15)', color: '#fff' }}>+ Playlist</button>
      </div>

      {/* Center transport. The container is click-through (pointer-events-none)
          so taps on empty areas fall through to the toggle handler and never
          block the top/bottom bars — only the buttons themselves are tappable. */}
      <div className={`absolute inset-0 flex items-center justify-center gap-4 transition-opacity pointer-events-none ${chrome ? 'opacity-100' : 'opacity-0'}`}>
        <button onClick={() => goTo(prevItem)} disabled={!prevItem}
                className="p-2 pointer-events-auto" style={{ opacity: prevItem ? 1 : 0.3 }}>
          <SkipBack size={30} color="#fff" fill="#fff" />
        </button>
        <button onClick={() => skip(-10)} className="p-2 pointer-events-auto"><RotateCcw size={30} color="#fff" /></button>
        <button onClick={togglePlay} className="p-5 rounded-full pointer-events-auto" style={{ background: 'var(--accent)' }}>
          {playing ? <Pause size={34} color="#fff" fill="#fff" /> : <Play size={34} color="#fff" fill="#fff" />}
        </button>
        <button onClick={() => skip(10)} className="p-2 pointer-events-auto"><RotateCw size={30} color="#fff" /></button>
        <button onClick={() => goTo(nextItem)} disabled={!nextItem}
                className="p-2 pointer-events-auto" style={{ opacity: nextItem ? 1 : 0.3 }}>
          <SkipForward size={30} color="#fff" fill="#fff" />
        </button>
      </div>

      {/* Bottom controls */}
      <div className={`absolute bottom-0 left-0 right-0 px-4 transition-opacity ${chrome ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
           style={{ paddingBottom: 'calc(var(--sab) + 14px)', paddingTop: 30, background: 'linear-gradient(to top, rgba(0,0,0,0.75), transparent)' }}
           onClick={e => e.stopPropagation()}>
        {/* Seek bar */}
        <div className="flex items-center gap-3 mb-3">
          <span className="text-[13px] text-white/70 w-10 text-right tabular-nums">{fmt(cur)}</span>
          <div className="flex-1 h-5 flex items-center cursor-pointer" onClick={seek}>
            <div className="w-full h-1.5 rounded-full bg-white/25 relative">
              <div className="absolute left-0 top-0 h-full rounded-full" style={{ width: `${pct}%`, background: 'var(--accent)' }} />
              <div className="absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full -ml-1.5" style={{ left: `${pct}%`, background: 'var(--accent)' }} />
            </div>
          </div>
          <span className="text-[13px] text-white/70 w-10 tabular-nums">{fmt(dur)}</span>
        </div>

        {/* Volume slider */}
        <div className="flex items-center gap-2 mb-3">
          <button onClick={toggleMute} className="p-1">
            {muted || volume === 0 ? <VolumeX size={20} color="#fff" /> : <Volume2 size={20} color="#fff" />}
          </button>
          <input type="range" min="0" max="1" step="0.01"
                 value={muted ? 0 : volume}
                 onChange={e => changeVolume(parseFloat(e.target.value))}
                 className="flex-1 accent-[var(--accent)] h-1"
                 style={{ accentColor: 'var(--accent)' }} />
        </div>

        {/* Action row: 10-star rating + speed + loop */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-0.5">
            {Array.from({ length: 10 }, (_, i) => i + 1).map(n => (
              <button key={n} onClick={() => rate((img?.rating || 0) === n ? 0 : n)} className="p-0.5">
                <Star size={18} color="var(--c-amber)" fill={(img?.rating || 0) >= n ? 'var(--c-amber)' : 'none'} />
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1">
            <button onClick={cycleSpeed} className="flex items-center gap-1 px-2.5 py-1.5 rounded-full text-[14px] font-semibold text-white"
                    style={{ background: 'rgba(255,255,255,0.12)' }}>
              <Gauge size={16} /> {SPEEDS[speedIdx]}×
            </button>
            <button onClick={() => { setLoop(l => !l); bumpChrome() }} className="p-2 rounded-full"
                    style={{ background: loop ? 'var(--accent)' : 'rgba(255,255,255,0.12)' }}>
              <Repeat size={20} color="#fff" />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

import React, { useState, useRef, useCallback, useEffect, useImperativeHandle, forwardRef } from 'react'
import { Play, Pause, Volume2, VolumeX, Repeat, Repeat1, Zap, Link2, Loader2, Minus, Plus, RotateCcw } from 'lucide-react'
import toast from 'react-hot-toast'
import { deviceService } from '../services/device'
import { useDeviceStore } from '../store/deviceStore'
import { imagesApi } from '../lib/api'

function fmtTime(s) {
  if (!s || !isFinite(s)) return '0:00'
  const h   = Math.floor(s / 3600)
  const m   = Math.floor((s % 3600) / 60)
  const sec = Math.floor(s % 60)
  if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`
  return `${m}:${String(sec).padStart(2,'0')}`
}

// Human-readable labels for T-Code axis IDs (used by the multi-axis badge row)
const AXIS_LABELS = {
  L0: 'Stroke', L1: 'Surge', L2: 'Sway',
  R0: 'Twist',  R1: 'Roll',  R2: 'Pitch',
}

// Axis IDs present in a loaded funscript. Single-axis → ['L0']; multi-axis adds
// rotation/extra axes. Derived from the funscript itself (not global state) so a
// player only ever reflects its OWN script — safe when several are mounted.
function axisIdsOf(data) {
  if (!data) return []
  const axes = data.axes && typeof data.axes === 'object' ? data.axes : null
  if (axes) {
    const ids = Object.keys(axes).filter(id => Array.isArray(axes[id]) && axes[id].length)
    if (ids.length) return ids
  }
  return data.actions?.length ? ['L0'] : []
}

function FunscriptWaveform({ actions, duration, currentTime }) {
  if (!actions?.length || !duration) return null

  const pts = actions.map(a => {
    const x = ((a.at / 1000) / duration) * 100
    const y = 100 - a.pos  // invert: pos 100% → top of strip
    return `${x.toFixed(2)},${y.toFixed(2)}`
  })

  const filled = ['0,100', ...pts, '100,100'].join(' ')
  const line   = pts.join(' ')
  const pct    = Math.min(100, (currentTime / duration) * 100)

  return (
    <div className="relative mb-1.5 rounded overflow-hidden" style={{ height: 30 }}>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 w-full h-full">
        <polygon points={filled} fill="color-mix(in srgb, var(--accent) 20%, transparent)" />
        <polyline points={line} fill="none" stroke="color-mix(in srgb, var(--accent) 65%, transparent)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
        <rect x="0" y="0" width={pct} height="100" fill="rgba(0,0,0,0.32)" />
        <line x1={pct} y1="0" x2={pct} y2="100" stroke="rgba(239,159,39,0.85)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
      </svg>
    </div>
  )
}

// Compact funscript live-stats readout shown next to the waveform when a
// script is loaded. Computes strokes, strokes/min, avg & peak speed, and
// timeline coverage from the raw action list — dense player-HUD styling
// (~12px) to match the surrounding chrome, not the 16px body-text minimum.
function FunscriptStatsPill({ actions, duration }) {
  if (!actions?.length) return null
  const count = actions.length
  const lastAt = actions[actions.length - 1]?.at ?? 0
  const coveragePct = duration ? Math.min(100, Math.round(((lastAt / 1000) / duration) * 100)) : null
  const spm = duration ? Math.round(count / (duration / 60)) : null

  // Per-interval speed in pos-units/sec between consecutive actions.
  // Intervals with non-positive time delta are skipped (bad/duplicate timestamps).
  let avgSpeed = null
  let peakSpeed = null
  if (count >= 2) {
    let total = 0, n = 0, peak = 0
    for (let i = 1; i < actions.length; i++) {
      const a = actions[i - 1], b = actions[i]
      const dtSec = (b.at - a.at) / 1000
      if (dtSec <= 0) continue
      const speed = Math.abs(b.pos - a.pos) / dtSec
      total += speed
      n += 1
      if (speed > peak) peak = speed
    }
    if (n > 0) {
      avgSpeed = Math.round(total / n)
      peakSpeed = Math.round(peak)
    }
  }

  const stats = [
    `${count.toLocaleString()} ${count === 1 ? 'stroke' : 'strokes'}`,
    spm !== null ? `${spm} SPM` : null,
    avgSpeed !== null ? `avg ${avgSpeed}` : null,
    peakSpeed !== null ? `peak ${peakSpeed}` : null,
    coveragePct !== null ? `${coveragePct}%` : null,
  ].filter(Boolean)

  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full flex-shrink-0 flex-wrap"
          style={{
            fontSize: 12, fontWeight: 600, color: 'color-mix(in srgb, var(--accent) 85%, white)',
            background: 'color-mix(in srgb, var(--accent) 16%, transparent)',
            border: '0.5px solid color-mix(in srgb, var(--accent) 35%, transparent)',
          }}>
      <Zap size={10} fill="currentColor" />
      FS · {stats.join(' · ')}
    </span>
  )
}

// Sync-offset nudge: shift funscript timing relative to the video (±2000ms,
// 50ms steps). Persisted per-video in localStorage; in-memory only when no
// imageId (e.g. an unsaved "play once" override script).
function FunscriptOffsetControl({ offsetMs, onChange }) {
  const step = 50
  const clamp = (v) => Math.max(-2000, Math.min(2000, v))
  return (
    <div className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full flex-shrink-0"
         style={{
           fontSize: 12, fontWeight: 600, color: 'color-mix(in srgb, var(--accent) 85%, white)',
           background: 'color-mix(in srgb, var(--accent) 12%, transparent)',
           border: '0.5px solid color-mix(in srgb, var(--accent) 30%, transparent)',
         }}>
      <span style={{ opacity: 0.75, paddingLeft: 4 }}>Sync</span>
      <button onMouseDown={e => { e.stopPropagation(); onChange(clamp(offsetMs - step)) }}
              title="Shift script earlier"
              className="cursor-pointer flex items-center justify-center rounded-full"
              style={{ width: 16, height: 16, background: 'rgba(255,255,255,0.08)' }}>
        <Minus size={9} />
      </button>
      <span className="font-mono tabular-nums" style={{ minWidth: 42, textAlign: 'center' }}>
        {offsetMs > 0 ? '+' : ''}{offsetMs}ms
      </span>
      <button onMouseDown={e => { e.stopPropagation(); onChange(clamp(offsetMs + step)) }}
              title="Shift script later"
              className="cursor-pointer flex items-center justify-center rounded-full"
              style={{ width: 16, height: 16, background: 'rgba(255,255,255,0.08)' }}>
        <Plus size={9} />
      </button>
      {offsetMs !== 0 && (
        <button onMouseDown={e => { e.stopPropagation(); onChange(0) }}
                title="Reset offset to 0"
                className="cursor-pointer flex items-center justify-center rounded-full ml-0.5"
                style={{ width: 16, height: 16, background: 'rgba(255,255,255,0.08)' }}>
          <RotateCcw size={9} />
        </button>
      )}
    </div>
  )
}

const InlineVideoPlayer = forwardRef(function InlineVideoPlayer({
  src,
  imageId           = null,
  funscriptPath     = null,
  overrideFunscript = null,
  onViewTracked,
  onEnded,
  onFunscriptChange,
  videoZoom    = 1,
  videoPan     = { x: 0, y: 0 },
  isFullscreen = false,
  showControls = true,
}, ref) {
  const videoRef    = useRef(null)
  const viewTracked = useRef(false)
  const seekBarRef  = useRef(null)
  const lastTimeRef = useRef(0)

  const [playing,      setPlaying]      = useState(false)
  const [time,         setTime]         = useState(0)
  const [duration,     setDuration]     = useState(0)
  const [volume,       setVolume]       = useState(1)
  const [muted,        setMuted]        = useState(false)
  const [loopVideo,    setLoopVideo]    = useState(false)
  const [funscript,    setFunscript]    = useState(null)
  const [scriptSynced, setScriptSynced] = useState(false)
  const [videoError,   setVideoError]   = useState(null)
  const [scriptDrag,   setScriptDrag]   = useState(false)  // .funscript being dragged over
  const [droppedScript, setDroppedScript] = useState(null) // { name, content, parsed } awaiting confirm
  const [linking,      setLinking]      = useState(false)
  const [funscriptOffsetMs, setFunscriptOffsetMs] = useState(0)
  const dragDepth = useRef(0)

  const deviceStatus    = useDeviceStore(s => s.status)
  const deviceConnected = deviceStatus === 'connected'

  const funscriptAxes  = useDeviceStore(s => s.funscriptAxes)
  const setDetectedAxes = useDeviceStore(s => s.setDetectedAxes)
  const setAxisEnabled  = useDeviceStore(s => s.setAxisEnabled)

  // Axes present in THIS player's script — drives the local badge row.
  const localAxes = axisIdsOf(funscript)

  useImperativeHandle(ref, () => ({
    togglePlay: () => {
      if (!videoRef.current) return
      videoRef.current.paused ? videoRef.current.play() : videoRef.current.pause()
    },
    seek: (delta) => {
      const v = videoRef.current
      if (!v) return
      const dur = v.duration
      if (!dur || isNaN(dur)) return
      v.currentTime = Math.max(0, Math.min(dur - 0.05, v.currentTime + delta))
      deviceService.onVideoSeek()
    },
    // Load a File (or File-like) and surface the same link-confirmation
    // dialog used by drag-and-drop, so the sidebar "Load .funscript" button
    // shares one flow with the video-drop path.
    promptLinkFunscript: async (file) => {
      if (!imageId || !file) return
      try {
        const content = await file.text()
        const parsed = JSON.parse(content)
        if (!Array.isArray(parsed.actions) || parsed.actions.length === 0) throw new Error('no actions')
        setDroppedScript({ name: file.name, content, parsed })
      } catch {
        toast.error('Not a valid funscript')
      }
    },
  }))

  // ── Critical: release video resources on unmount ─────────────────────────
  // Without this, navigating away leaves the video element buffering in the
  // background, holding a file handle open on the HDD. On slow drives with
  // multiple open videos this causes the app to lock up.
  useEffect(() => {
    return () => {
      const v = videoRef.current
      if (!v) return
      v.pause()
      v.removeAttribute('src')
      v.load() // forces the browser to tear down its media pipeline
    }
  }, [])

  useEffect(() => {
    const apply = (data) => {
      setFunscript(data?.actions ? data : null)
      setDetectedAxes(axisIdsOf(data))
    }
    if (overrideFunscript?.actions) { apply(overrideFunscript); return }
    if (!imageId || !funscriptPath) { apply(null); return }
    fetch(`/api/images/${imageId}/funscript`)
      .then(r => r.ok ? r.json() : null)
      .then(apply)
      .catch(() => apply(null))
    return () => setDetectedAxes([])
  }, [imageId, funscriptPath, overrideFunscript])

  useEffect(() => {
    if (!funscript || !videoRef.current) return
    deviceService.loadFunscript(funscript, videoRef.current)
    return () => {
      deviceService.releaseFunscriptControl()
      deviceService.unloadFunscript()
      setScriptSynced(false)
    }
  }, [funscript])

  // Sync-offset persistence: keyed per-video by imageId. When imageId is null
  // (an unsaved/override script with no linked image), the offset lives in
  // memory only for the duration of this mount and resets on next load.
  useEffect(() => {
    if (!imageId) { setFunscriptOffsetMs(0); deviceService.setFunscriptOffset(0); return }
    let stored = 0
    try {
      const raw = localStorage.getItem(`vault_fs_offset_${imageId}`)
      if (raw !== null) stored = parseInt(raw, 10) || 0
    } catch {}
    setFunscriptOffsetMs(stored)
    deviceService.setFunscriptOffset(stored)
  }, [imageId])

  const handleOffsetChange = useCallback((ms) => {
    setFunscriptOffsetMs(ms)
    if (imageId) {
      try { localStorage.setItem(`vault_fs_offset_${imageId}`, String(ms)) } catch {}
    }
    deviceService.setFunscriptOffset(ms)
  }, [imageId])

  const toggleScriptSync = useCallback(() => {
    if (!scriptSynced) {
      deviceService.takeFunscriptControl()
      setScriptSynced(true)
    } else {
      deviceService.releaseFunscriptControl()
      setScriptSynced(false)
    }
  }, [scriptSynced])

  const togglePlay = useCallback(() => {
    if (!videoRef.current) return
    videoRef.current.paused ? videoRef.current.play() : videoRef.current.pause()
  }, [])

  const handlePlay = useCallback(() => {
    setPlaying(true)
    deviceService.onVideoPlay()
    if (!viewTracked.current && onViewTracked) {
      viewTracked.current = true
      onViewTracked()
    }
  }, [onViewTracked])

  const handlePause = useCallback(() => {
    setPlaying(false)
    deviceService.onVideoPause()
  }, [])

  const seek = useCallback((delta) => {
    const v = videoRef.current
    if (!v) return
    const dur = v.duration
    if (!dur || isNaN(dur)) return
    v.currentTime = Math.max(0, Math.min(dur - 0.05, v.currentTime + delta))
    deviceService.onVideoSeek()
  }, [])

  useEffect(() => {
    const bar = seekBarRef.current
    if (!bar) return

    const applySeek = (clientX) => {
      const v = videoRef.current
      if (!v) return
      const dur = v.duration
      if (!dur || isNaN(dur)) return
      const rect = bar.getBoundingClientRect()
      const frac = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
      v.currentTime = Math.min(dur - 0.05, frac * dur)
      deviceService.onVideoSeek()
    }

    const handleDown = (e) => {
      e.stopPropagation()
      e.preventDefault()
      applySeek(e.clientX)
      const onMove = (ev) => applySeek(ev.clientX)
      const onUp = () => {
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp, { capture: true })
      }
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp, { capture: true })
    }

    bar.addEventListener('mousedown', handleDown)
    return () => bar.removeEventListener('mousedown', handleDown)
  }, [])

  const handleVolumeChange = useCallback((e) => {
    const v = parseFloat(e.target.value)
    setVolume(v)
    if (videoRef.current) videoRef.current.volume = v
    if (v > 0) setMuted(false)
  }, [])

  const toggleMute = useCallback(() => {
    if (!videoRef.current) return
    videoRef.current.muted = !videoRef.current.muted
    setMuted(videoRef.current.muted)
  }, [])

  const pct = duration ? (time / duration) * 100 : 0

  // Human-readable error from the browser's MediaError code
  const handleVideoError = useCallback(() => {
    const v = videoRef.current
    const code = v?.error?.code
    const msgs = {
      1: 'Playback aborted.',
      2: 'Network error while loading video.',
      3: 'Video decoding failed — the codec or encoding is not supported by this browser.\nThe file likely plays fine in VLC. Common culprits: H.265/HEVC, Xvid/DivX, WMV.',
      4: 'Video format or codec not supported by this browser.\nTry H.264 MP4 — it plays everywhere. VLC can re-encode it.',
    }
    setVideoError(msgs[code] ?? 'Unknown video error.')
  }, [])

  // ── Funscript drag-and-drop: drop a .funscript onto the video to link it ──
  const isFileDrag = (e) => e.dataTransfer?.types?.includes('Files')

  const onScriptDragEnter = useCallback((e) => {
    if (!imageId || !isFileDrag(e)) return
    e.preventDefault()
    dragDepth.current += 1
    setScriptDrag(true)
  }, [imageId])

  const onScriptDragLeave = useCallback((e) => {
    if (!isFileDrag(e)) return
    dragDepth.current = Math.max(0, dragDepth.current - 1)
    if (dragDepth.current === 0) setScriptDrag(false)
  }, [])

  const onScriptDrop = useCallback(async (e) => {
    if (!imageId || !isFileDrag(e)) return
    e.preventDefault()
    e.stopPropagation()
    dragDepth.current = 0
    setScriptDrag(false)
    const file = [...(e.dataTransfer.files || [])].find(f => f.name.toLowerCase().endsWith('.funscript'))
    if (!file) { toast.error('Drop a .funscript file'); return }
    try {
      const content = await file.text()
      const parsed = JSON.parse(content)
      if (!Array.isArray(parsed.actions) || parsed.actions.length === 0) throw new Error('no actions')
      setDroppedScript({ name: file.name, content, parsed })
    } catch {
      toast.error('Not a valid funscript')
    }
  }, [imageId])

  const applyScriptLocally = useCallback((parsed) => {
    setFunscript(parsed)
    setDetectedAxes(axisIdsOf(parsed))
  }, [setDetectedAxes])

  const linkDroppedScript = useCallback(async () => {
    if (!droppedScript || !imageId) return
    setLinking(true)
    try {
      await imagesApi.linkFunscript(imageId, droppedScript.content)
      applyScriptLocally(droppedScript.parsed)
      toast.success('Funscript linked to this video')
      setDroppedScript(null)
      onFunscriptChange?.()
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Could not link funscript')
    } finally {
      setLinking(false)
    }
  }, [droppedScript, imageId, applyScriptLocally, onFunscriptChange])

  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{ background: '#060606' }}
         onDragEnter={onScriptDragEnter}
         onDragOver={e => { if (imageId && isFileDrag(e)) e.preventDefault() }}
         onDragLeave={onScriptDragLeave}
         onDrop={onScriptDrop}>

      {/* Drop hint */}
      {scriptDrag && (
        <div className="absolute inset-0 z-40 flex flex-col items-center justify-center gap-3 pointer-events-none animate-fade-in"
             style={{ background: 'rgba(0,0,0,0.7)', border: '2px dashed color-mix(in srgb, var(--accent) 70%, transparent)', borderRadius: 12 }}>
          <Link2 size={34} style={{ color: 'color-mix(in srgb, var(--accent) 85%, white)' }} />
          <div style={{ fontSize: 16, fontWeight: 600, color: 'color-mix(in srgb, var(--accent) 85%, white)' }}>
            Drop .funscript to link it to this video
          </div>
        </div>
      )}

      {/* Link confirmation */}
      {droppedScript && (
        <div className="absolute inset-0 z-40 flex items-center justify-center"
             style={{ background: 'rgba(0,0,0,0.75)' }}
             onMouseDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()}
             onDoubleClick={e => e.stopPropagation()}>
          <div className="rounded-[14px] p-5 flex flex-col gap-3 animate-modal-pop"
               style={{ width: 'min(400px, 90%)', background: 'var(--c-card, #1a1a1a)', border: '0.5px solid rgba(255,255,255,0.12)' }}>
            <div className="flex items-center gap-2">
              <Zap size={17} style={{ color: 'var(--c-pink)' }} />
              <span className="truncate" style={{ fontSize: 15, fontWeight: 600, color: 'rgba(255,255,255,0.9)' }}>
                {droppedScript.name}
              </span>
            </div>
            <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.5)', lineHeight: 1.45 }}>
              Link this script to the video permanently? It will be saved next to the video
              {funscriptPath ? ' and replace the current script.' : '.'}
            </div>
            <button onMouseDown={linkDroppedScript} disabled={linking}
                    className="w-full flex items-center justify-center gap-2 py-2.5 rounded-[10px] cursor-pointer disabled:opacity-50"
                    style={{ background: 'var(--accent)', color: '#fff', fontSize: 14, fontWeight: 600 }}>
              {linking ? <Loader2 size={15} className="animate-spin" /> : <Link2 size={15} />}
              Link permanently
            </button>
            <button onMouseDown={() => { applyScriptLocally(droppedScript.parsed); setDroppedScript(null) }}
                    className="w-full py-2.5 rounded-[10px] cursor-pointer"
                    style={{ background: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.75)', fontSize: 14 }}>
              Just play once (don't save)
            </button>
            <button onMouseDown={() => setDroppedScript(null)}
                    className="w-full py-1.5 cursor-pointer"
                    style={{ background: 'transparent', color: 'rgba(255,255,255,0.4)', fontSize: 13 }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Codec / format error overlay */}
      {videoError && (
        <div className="absolute inset-0 z-40 flex flex-col items-center justify-center gap-4 px-8 text-center"
             style={{ background: 'rgba(0,0,0,0.85)' }}>
          <div style={{ fontSize: 36, lineHeight: 1 }}>🎬</div>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'rgba(255,255,255,0.85)', whiteSpace: 'pre-line' }}>
            {videoError}
          </div>
          <button
            onClick={() => { setVideoError(null); videoRef.current?.load() }}
            style={{
              marginTop: 4, padding: '6px 18px', borderRadius: 8, fontSize: 13, cursor: 'pointer',
              background: 'rgba(127,119,221,0.25)', color: '#CECBF6',
              border: '0.5px solid rgba(127,119,221,0.4)',
            }}>
            Retry
          </button>
        </div>
      )}

      <video
        ref={videoRef}
        src={src}
        autoPlay loop={onEnded ? false : loopVideo}
        onEnded={onEnded}
        style={{
          width: '100%', height: '100%', objectFit: 'contain',
          outline: 'none', pointerEvents: 'none',
          transform: `translate(${videoPan.x}px, ${videoPan.y}px) scale(${videoZoom})`,
          transformOrigin: 'center center', transition: 'none',
        }}
        onPlay={handlePlay}
        onPause={handlePause}
        onError={handleVideoError}
        onTimeUpdate={() => {
          const v = videoRef.current
          if (!v) return
          const t = v.currentTime
          // Native `loop` seeks back to 0 without firing ended/seeked/play, so the
          // funscript scheduler is never re-armed. Detect the backward wrap and
          // re-arm device sync from the new position.
          if (lastTimeRef.current - t > 0.5) deviceService.onVideoSeek()
          lastTimeRef.current = t
          setTime(t)
        }}
        onLoadedMetadata={() => {
          const v = videoRef.current
          if (!v) return
          setDuration(v.duration)
          lastTimeRef.current = 0
          setVideoError(null)   // clear any previous error if a new src loaded OK
          // Explicitly call play() — browsers occasionally ignore the autoPlay
          // attribute after rapid navigation, e.g. jumping between funscript videos.
          v.play().catch(() => {})
        }}
      />

      <div className="absolute bottom-0 left-0 right-0 z-30 px-5 pb-4 pt-14 pointer-events-none"
           style={{
             background: 'linear-gradient(to bottom, transparent, rgba(0,0,0,0.85))',
             opacity: isFullscreen && !showControls ? 0 : 1,
             transition: 'opacity 0.25s ease',
             pointerEvents: isFullscreen && !showControls ? 'none' : undefined,
           }}>
        <div className="pointer-events-auto"
             onMouseDown={e => e.stopPropagation()}
             onClick={e => e.stopPropagation()}
             onDoubleClick={e => e.stopPropagation()}>

          {funscript && (
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <div className="flex-1 min-w-0">
                <FunscriptWaveform actions={funscript.actions} duration={duration} currentTime={time} />
              </div>
              <FunscriptStatsPill actions={funscript.actions} duration={duration} />
              <FunscriptOffsetControl offsetMs={funscriptOffsetMs} onChange={handleOffsetChange} />
            </div>
          )}

          {funscript && localAxes.length > 1 && (
            <div className="flex items-center gap-1.5 mb-2 flex-wrap">
              {localAxes.map(id => {
                const on = funscriptAxes[id] !== false
                return (
                  <button key={id}
                          onMouseDown={e => { e.stopPropagation(); setAxisEnabled(id, !on) }}
                          title={on ? `${AXIS_LABELS[id] || id} active — click to mute this axis`
                                    : `${AXIS_LABELS[id] || id} muted — click to enable`}
                          className="px-2 py-0.5 rounded-full text-[12px] font-semibold flex items-center gap-1 transition-all cursor-pointer"
                          style={on
                            ? { background: 'rgba(127,119,221,0.28)', color: '#CECBF6', border: '0.5px solid rgba(127,119,221,0.5)' }
                            : { background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.35)', border: '0.5px solid rgba(255,255,255,0.1)' }}>
                    <span className="font-mono">{id}</span>
                    <span style={{ opacity: 0.7 }}>{AXIS_LABELS[id] || ''}</span>
                  </button>
                )
              })}
            </div>
          )}

          <div ref={seekBarRef}
               className="mb-3 h-1.5 rounded-full cursor-pointer relative group"
               style={{ background: 'rgba(255,255,255,0.18)' }}>
            <div className="h-full rounded-full transition-none" style={{ width: `${pct}%`, background: '#BA7517' }} />
            <div className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                 style={{ left: `calc(${pct}% - 6px)`, background: '#EF9F27', boxShadow: '0 0 6px rgba(239,159,39,0.6)' }} />
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 flex-1">
              <button onMouseDown={e => { e.stopPropagation(); toggleMute() }}
                      className="cursor-pointer flex-shrink-0 p-1"
                      style={{ color: 'rgba(255,255,255,0.6)' }}>
                {muted || volume === 0 ? <VolumeX size={16} /> : <Volume2 size={16} />}
              </button>
              <input type="range" min={0} max={1} step={0.05} value={muted ? 0 : volume}
                     onMouseDown={e => e.stopPropagation()}
                     onChange={handleVolumeChange}
                     className="w-24 h-1.5 cursor-pointer accent-[#BA7517]" />
              <button onMouseDown={e => { e.stopPropagation(); setLoopVideo(l => !l) }}
                      title={loopVideo ? 'Loop on' : 'Loop off'}
                      className="cursor-pointer flex-shrink-0 ml-1 p-1"
                      style={{ color: loopVideo ? '#BA7517' : 'rgba(255,255,255,0.35)' }}>
                {loopVideo ? <Repeat1 size={16} /> : <Repeat size={16} />}
              </button>
              {deviceConnected && funscript && (
                <button onMouseDown={e => { e.stopPropagation(); toggleScriptSync() }}
                        title={scriptSynced ? 'Device synced to script — click to disable' : 'Sync device to funscript'}
                        className="cursor-pointer flex-shrink-0 ml-1 px-2 py-0.5 rounded text-[12px] font-semibold flex items-center gap-1 transition-all"
                        style={scriptSynced
                          ? { background: 'rgba(127,119,221,0.3)', color: '#CECBF6', border: '0.5px solid rgba(127,119,221,0.5)' }
                          : { background: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.4)', border: '0.5px solid rgba(255,255,255,0.12)' }}>
                  <Zap size={10} fill={scriptSynced ? 'currentColor' : 'none'} />
                  {scriptSynced ? 'Synced' : 'Sync'}
                </button>
              )}
            </div>

            <div className="flex items-center gap-2 flex-shrink-0">
              <button onMouseDown={e => { e.stopPropagation(); seek(-3) }}
                      className="text-[13px] px-3 py-1.5 rounded-[6px] cursor-pointer font-mono"
                      style={{ color: 'rgba(255,255,255,0.6)', background: 'rgba(255,255,255,0.1)' }}>
                −3s
              </button>
              <button onMouseDown={e => { e.stopPropagation(); togglePlay() }}
                      className="w-9 h-9 rounded-full flex items-center justify-center cursor-pointer flex-shrink-0"
                      style={{ background: 'rgba(255,255,255,0.2)', border: '0.5px solid rgba(255,255,255,0.3)' }}>
                {playing ? <Pause size={14} color="#fff" /> : <Play size={14} color="#fff" />}
              </button>
              <button onMouseDown={e => { e.stopPropagation(); seek(3) }}
                      className="text-[13px] px-3 py-1.5 rounded-[6px] cursor-pointer font-mono"
                      style={{ color: 'rgba(255,255,255,0.6)', background: 'rgba(255,255,255,0.1)' }}>
                +3s
              </button>
            </div>

            <div className="flex-1 flex justify-end text-[13px] font-mono tabular-nums"
                 style={{ color: 'rgba(255,255,255,0.5)' }}>
              {fmtTime(time)} / {fmtTime(duration)}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
})

export default InlineVideoPlayer

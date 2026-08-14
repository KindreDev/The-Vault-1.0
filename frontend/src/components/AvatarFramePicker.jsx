import React, { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useQueryClient } from '@tanstack/react-query'
import { X, Camera, Film, Play, Pause, ChevronLeft, ChevronRight, SkipBack, SkipForward } from 'lucide-react'
import toast from 'react-hot-toast'
import { creatorsApi } from '../lib/api'
import { useVaultStore } from '../store/vault'
import { useT } from '../i18n'

const CLIP_SECONDS = 3
const FRAME = 1 / 30

function fmt(s) {
  if (!isFinite(s)) return '0:00'
  const m = Math.floor(s / 60)
  const sec = s - m * 60
  return `${m}:${sec < 10 ? '0' : ''}${sec.toFixed(1)}`
}

/**
 * Modal to pick a video frame (or a short animated clip) as a creator avatar or banner.
 * Custom scrub bar shows exactly which frame / clip range will be captured.
 *
 * Props
 *   creatorId – target creator
 *   image     – the video image record ({ id, filename })
 *   mode      – 'avatar' (default) | 'banner'
 *   onClose
 *   onSuccess – optional, called after a successful capture (before onClose)
 */
export default function AvatarFramePicker({ creatorId, image, mode = 'avatar', onClose, onSuccess }) {
  const t = useT()
  const qc = useQueryClient()
  const videoRef = useRef(null)
  const trackRef = useRef(null)
  const rafRef   = useRef(null)
  const [busy, setBusy]       = useState(null)   // null | 'frame' | 'clip'
  const [playing, setPlaying] = useState(false)
  const [dur, setDur]         = useState(0)
  const [cur, setCur]         = useState(0)
  const bumpAvatarBust = useVaultStore(s => s.bumpAvatarBust)

  const isBanner = mode === 'banner'

  // Smooth playhead — rAF while mounted (timeupdate alone is too choppy for a scrubber)
  useEffect(() => {
    const tick = () => {
      const v = videoRef.current
      if (v) { setCur(v.currentTime); setPlaying(!v.paused && !v.ended) }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [])

  const seekTo = useCallback((time) => {
    const v = videoRef.current
    if (!v || !isFinite(dur) || dur === 0) return
    v.currentTime = Math.min(Math.max(0, time), Math.max(0, dur - FRAME))
  }, [dur])

  const seekFromPointer = useCallback((clientX) => {
    const track = trackRef.current
    if (!track) return
    const r = track.getBoundingClientRect()
    seekTo(((clientX - r.left) / r.width) * dur)
  }, [dur, seekTo])

  const onTrackPointerDown = (e) => {
    e.preventDefault()
    videoRef.current?.pause()
    seekFromPointer(e.clientX)
    const move = (ev) => seekFromPointer(ev.clientX)
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const togglePlay = () => {
    const v = videoRef.current
    if (!v) return
    v.paused ? v.play() : v.pause()
  }

  const capture = async (clip) => {
    const vid = videoRef.current
    if (!vid || busy) return
    vid.pause()
    setBusy(clip ? 'clip' : 'frame')
    try {
      const fn = isBanner ? creatorsApi.setBannerFromVideo : creatorsApi.setAvatarFromVideo
      await fn(creatorId, image.id, vid.currentTime, clip)
      toast.success(isBanner
        ? (clip ? t('Animated banner set!') : t('Banner updated!'))
        : (clip ? t('Animated avatar set!') : t('Avatar updated!')))
      qc.invalidateQueries({ queryKey: ['creator', String(creatorId)] })
      qc.invalidateQueries({ queryKey: ['creators'] })
      bumpAvatarBust()
      onSuccess?.()
      onClose()
    } catch (e) {
      toast.error(e?.response?.data?.detail || t('Failed to extract from video'))
      setBusy(null)
    }
  }

  const pct       = dur > 0 ? (cur / dur) * 100 : 0
  const clipEnd   = dur > 0 ? Math.min(cur + CLIP_SECONDS, dur) : 0
  const clipPct   = dur > 0 ? ((clipEnd - cur) / dur) * 100 : 0
  const accent    = 'var(--accent)'

  const StepBtn = ({ icon: Icon, onClick, title }) => (
    <button onClick={onClick} title={title}
            className="cursor-pointer flex items-center justify-center rounded-full transition-colors"
            style={{ width: 32, height: 32, color: 'rgba(255,255,255,0.65)', background: 'rgba(255,255,255,0.06)', border: '0.5px solid rgba(255,255,255,0.1)' }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.13)' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)' }}>
      <Icon size={14} />
    </button>
  )

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center"
         style={{ background: 'rgba(0,0,0,0.82)', backdropFilter: 'blur(8px)' }}
         onClick={e => e.target === e.currentTarget && !busy && onClose()}>
      <div className="rounded-[16px] w-[760px] max-w-[94vw] overflow-hidden"
           style={{
             background: 'linear-gradient(180deg, #1d1d21 0%, #151517 100%)',
             border: '0.5px solid rgba(255,255,255,0.13)',
             boxShadow: '0 24px 80px rgba(0,0,0,0.7)',
           }}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4"
             style={{ borderBottom: '0.5px solid rgba(255,255,255,0.07)' }}>
          <div className="min-w-0">
            <div className="text-[16px] font-semibold text-[rgba(255,255,255,0.92)]">
              {isBanner ? t('Set banner from video') : t('Set avatar from video')}
            </div>
            <div className="text-[12px] truncate mt-0.5" style={{ color: 'rgba(255,255,255,0.35)' }}>{image.filename}</div>
          </div>
          <button onClick={() => !busy && onClose()}
                  className="cursor-pointer flex items-center justify-center rounded-full"
                  style={{ width: 30, height: 30, color: 'rgba(255,255,255,0.45)', background: 'rgba(255,255,255,0.06)' }}>
            <X size={15} />
          </button>
        </div>

        {/* Video */}
        <div className="relative" style={{ background: '#000' }}>
          <video
            ref={videoRef}
            src={`/api/images/${image.id}/file`}
            muted
            playsInline
            preload="metadata"
            onClick={togglePlay}
            onLoadedMetadata={e => setDur(e.currentTarget.duration || 0)}
            onTimeUpdate={e => setCur(e.currentTarget.currentTime)}
            onSeeked={e => setCur(e.currentTarget.currentTime)}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            style={{ width: '100%', maxHeight: '52vh', display: 'block', cursor: 'pointer' }}
          />
          {/* Center play overlay when paused */}
          {!playing && !busy && (
            <div onClick={togglePlay}
                 className="absolute inset-0 flex items-center justify-center cursor-pointer">
              <div className="flex items-center justify-center rounded-full"
                   style={{ width: 62, height: 62, background: 'rgba(0,0,0,0.55)', border: '1px solid rgba(255,255,255,0.25)', backdropFilter: 'blur(6px)' }}>
                <Play size={26} fill="white" stroke="none" style={{ marginLeft: 4 }} />
              </div>
            </div>
          )}
        </div>

        {/* Scrubber + controls */}
        <div className="px-5 pt-4 pb-5 flex flex-col gap-3">

          {/* Custom seek bar */}
          <div className="relative select-none" style={{ padding: '8px 0', cursor: 'pointer' }}
               ref={trackRef} onPointerDown={onTrackPointerDown}>
            {/* track */}
            <div className="relative rounded-full overflow-visible" style={{ height: 7, background: 'rgba(255,255,255,0.09)' }}>
              {/* played fill */}
              <div className="absolute inset-y-0 left-0 rounded-full"
                   style={{ width: `${pct}%`, background: `color-mix(in srgb, ${accent} 55%, transparent)` }} />
              {/* clip range — what "Use 3s clip" will capture */}
              <div className="absolute inset-y-0 rounded-[3px]"
                   style={{
                     left: `${pct}%`, width: `${clipPct}%`,
                     background: 'color-mix(in srgb, var(--c-pink) 45%, transparent)',
                     border: '1px solid rgba(237,147,177,0.75)',
                     boxShadow: '0 0 10px color-mix(in srgb, var(--c-pink) 45%, transparent)',
                   }} />
              {/* playhead — the exact frame that gets captured */}
              <div className="absolute" style={{ left: `${pct}%`, top: -5, bottom: -5, width: 3, marginLeft: -1.5, borderRadius: 2, background: '#fff', boxShadow: `0 0 8px ${accent}, 0 0 3px rgba(0,0,0,0.8)` }} />
            </div>
          </div>

          {/* Transport row */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <button onClick={togglePlay}
                      className="cursor-pointer flex items-center justify-center rounded-full transition-transform active:scale-95"
                      style={{ width: 40, height: 40, background: `color-mix(in srgb, ${accent} 26%, transparent)`, border: `0.5px solid color-mix(in srgb, ${accent} 50%, transparent)`, color: '#fff' }}>
                {playing ? <Pause size={17} /> : <Play size={17} style={{ marginLeft: 2 }} />}
              </button>
              <StepBtn icon={SkipBack}     onClick={() => seekTo(cur - 1)}     title={t('Back 1s')} />
              <StepBtn icon={ChevronLeft}  onClick={() => seekTo(cur - FRAME)} title={t('Previous frame')} />
              <StepBtn icon={ChevronRight} onClick={() => seekTo(cur + FRAME)} title={t('Next frame')} />
              <StepBtn icon={SkipForward}  onClick={() => seekTo(cur + 1)}     title={t('Forward 1s')} />
            </div>

            <div className="flex items-baseline gap-1.5 font-mono">
              <span className="text-[15px] font-semibold" style={{ color: 'rgba(255,255,255,0.9)' }}>{fmt(cur)}</span>
              <span className="text-[12px]" style={{ color: 'rgba(255,255,255,0.3)' }}>/ {fmt(dur)}</span>
            </div>
          </div>

          {/* Legend */}
          <div className="flex items-center gap-4 text-[12px]" style={{ color: 'rgba(255,255,255,0.4)' }}>
            <span className="flex items-center gap-1.5">
              <span style={{ width: 3, height: 12, borderRadius: 2, background: '#fff', boxShadow: `0 0 6px ${accent}`, display: 'inline-block' }} />
              {t('captured frame')}
            </span>
            <span className="flex items-center gap-1.5">
              <span style={{ width: 18, height: 8, borderRadius: 3, background: 'color-mix(in srgb, var(--c-pink) 45%, transparent)', border: '1px solid rgba(237,147,177,0.75)', display: 'inline-block' }} />
              {t('3s clip range')}
            </span>
          </div>

          {/* Capture buttons */}
          <div className="flex items-center justify-center gap-3 mt-1">
            <button onClick={() => capture(false)} disabled={!!busy}
                    className="flex items-center gap-2 px-6 py-2.5 rounded-full text-[13px] font-semibold cursor-pointer disabled:opacity-40 transition-transform active:scale-[0.97]"
                    style={{ background: `color-mix(in srgb, ${accent} 28%, transparent)`, color: '#fff', border: `0.5px solid color-mix(in srgb, ${accent} 55%, transparent)` }}>
              <Camera size={14} /> {busy === 'frame' ? t('Capturing…') : t('Use this frame')}
            </button>
            <button onClick={() => capture(true)} disabled={!!busy}
                    className="flex items-center gap-2 px-6 py-2.5 rounded-full text-[13px] font-semibold cursor-pointer disabled:opacity-40 transition-transform active:scale-[0.97]"
                    style={{ background: 'color-mix(in srgb, var(--c-pink) 20%, transparent)', color: 'var(--c-pink-text)', border: '0.5px solid color-mix(in srgb, var(--c-pink) 45%, transparent)' }}>
              <Film size={14} /> {busy === 'clip' ? t('Rendering clip…') : t('Use 3s animated clip')}
            </button>
          </div>
          {busy === 'clip' && (
            <div className="text-[12px] text-center" style={{ color: 'rgba(255,255,255,0.3)' }}>
              {t('Encoding animated WebP — this can take a few seconds')}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}

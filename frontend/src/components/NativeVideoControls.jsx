import React, { useEffect, useState } from 'react'
import { Play, Pause, Volume2, VolumeX, Maximize } from 'lucide-react'
import { useT } from '../i18n'

const clock = value => {
  const seconds = Math.max(0, Math.floor(Number(value) || 0))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

// Compact controls occupy the same bottom edge as the former browser controls.
// Transport and the clock belong to VLC; no second browser media stream exists.
export default function NativeVideoControls({ player, container }) {
  const t = useT()
  const [, refresh] = useState(0)
  useEffect(() => {
    if (!player) return
    const update = () => refresh(value => value + 1)
    const events = ['timeupdate', 'play', 'pause', 'ended', 'loadedmetadata', 'volumechange', 'error']
    events.forEach(event => player.addEventListener(event, update))
    return () => events.forEach(event => player.removeEventListener(event, update))
  }, [player])
  const duration = Number.isFinite(player?.duration) ? player.duration : 0
  const time = Math.min(duration, player?.currentTime || 0)
  const button = { padding: 6, color: 'white', cursor: 'pointer', background: 'transparent', border: 0 }
  return <div onClick={event => event.stopPropagation()} onMouseDown={event => event.stopPropagation()}
              style={{ gridArea: 'video', alignSelf: 'end', zIndex: 1, padding: '24px 12px 8px', color: 'white',
                background: 'linear-gradient(transparent, rgba(0,0,0,.88))', minWidth: 0 }}>
    {player?.error && <div role="alert" style={{ fontSize: 16, paddingBottom: 8 }}>{t('Video playback failed')}: {player.error.message}</div>}
    <input aria-label={t('Seek video')} type="range" min="0" max={duration || 1} step="0.1" value={time}
           disabled={!duration} onChange={event => { player.currentTime = Number(event.target.value) }}
           style={{ width: '100%', accentColor: 'var(--c-accent)', cursor: 'pointer' }} />
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
      <button type="button" style={button} aria-label={t(player?.paused ? 'Play' : 'Pause')}
              onClick={() => { if (player) player.paused ? player.play().catch(() => {}) : player.pause() }}>
        {player?.paused ? <Play size={20} /> : <Pause size={20} />}
      </button>
      <span style={{ fontSize: 16, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{clock(time)} / {clock(duration)}</span>
      <button type="button" style={button} aria-label={t(player?.muted ? 'Unmute' : 'Mute')}
              onClick={() => { if (player) player.muted = !player.muted }}>
        {player?.muted || player?.volume === 0 ? <VolumeX size={20} /> : <Volume2 size={20} />}
      </button>
      <input aria-label={t('Volume')} type="range" min="0" max="1" step="0.05" value={player?.muted ? 0 : player?.volume ?? 1}
             onChange={event => { if (player) { player.volume = Number(event.target.value); player.muted = false } }}
             style={{ width: 70, minWidth: 35, accentColor: 'var(--c-accent)' }} />
      <button type="button" style={{ ...button, marginLeft: 'auto' }} aria-label={t('Fullscreen')}
              onClick={() => {
                const result = document.fullscreenElement ? document.exitFullscreen() : container.current?.requestFullscreen()
                result?.catch(() => {})
              }}><Maximize size={20} /></button>
    </div>
  </div>
}

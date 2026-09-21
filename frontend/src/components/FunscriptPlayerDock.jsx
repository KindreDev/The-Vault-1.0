import React, { useMemo, useRef } from 'react'
import { CircleStop, GripVertical, Play, Pause, Repeat, Shuffle, SkipBack, SkipForward, Volume2, X } from 'lucide-react'
import { useFunscriptPlayerStore } from '../store/funscriptPlayerStore'
import { useDeviceStore } from '../store/deviceStore'
import '../pages/funscripts.css'

const panelStyle = {
  background: 'color-mix(in srgb, var(--c-surface, #161616) 96%, black)',
  border: '1px solid color-mix(in srgb, var(--c-accent) 25%, transparent)',
  boxShadow: '0 -12px 40px rgba(0,0,0,.35)',
  color: 'var(--c-text, rgba(255,255,255,.85))',
}

function formatTime(seconds) {
  const value = Math.max(0, Math.round(Number(seconds) || 0))
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`
}

function Waveform({ payload, currentTime, duration }) {
  const points = useMemo(() => {
    const axes = payload?.axes && typeof payload.axes === 'object' ? payload.axes : { L0: payload?.actions || [] }
    const actions = Object.values(axes).find(a => Array.isArray(a) && a.length) || []
    if (!actions.length) return ''
    const width = 900
    return actions.map(action => {
      const x = Math.max(0, Math.min(width, ((action.at / 1000) / Math.max(duration, .01)) * width))
      const y = 64 - (Math.max(0, Math.min(100, action.pos)) / 100) * 64
      return `${x.toFixed(1)},${y.toFixed(1)}`
    }).join(' ')
  }, [payload, duration])
  const progress = duration ? Math.max(0, Math.min(1, currentTime / duration)) : 0
  return <div className="fs-dock-waveform">
    <svg viewBox="0 0 900 64" preserveAspectRatio="none" aria-label="Funscript waveform">
      {points && <polyline points={points} fill="none" stroke="color-mix(in srgb, var(--c-accent) 86%, white)" strokeWidth="2.5" vectorEffect="non-scaling-stroke" />}
      <line x1={progress * 900} x2={progress * 900} y1="0" y2="64" stroke="var(--c-pink, #D4537E)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
  </div>
}

function IconButton({ title, onClick, active, children, disabled = false }) {
  return <button type="button" className={`fs-dock-icon ${active ? 'is-active' : ''}`} title={title} aria-label={title} disabled={disabled} onClick={onClick}>{children}</button>
}

function hiddenTabStyle(edge, offset) {
  const common = { position: 'fixed', zIndex: 9990, width: 34, height: 34, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: '1px solid color-mix(in srgb, var(--c-accent) 55%, transparent)', background: 'color-mix(in srgb, var(--c-surface, #161616) 94%, black)', color: 'var(--c-accent-text, var(--c-accent))', boxShadow: '0 4px 18px rgba(0,0,0,.35)', cursor: 'grab', touchAction: 'none' }
  if (edge === 'left') return { ...common, left: 4, top: `${offset}%`, transform: 'translateY(-50%)', borderRadius: '0 10px 10px 0' }
  if (edge === 'top') return { ...common, top: 4, left: `${offset}%`, transform: 'translateX(-50%)', borderRadius: '0 0 10px 10px' }
  if (edge === 'bottom') return { ...common, bottom: 4, left: `${offset}%`, transform: 'translateX(-50%)', borderRadius: '10px 10px 0 0' }
  return { ...common, right: 4, top: `${offset}%`, transform: 'translateY(-50%)', borderRadius: '10px 0 0 10px' }
}

export default function FunscriptPlayerDock() {
  const current = useFunscriptPlayerStore(s => s.current)
  const payload = useFunscriptPlayerStore(s => s.payload)
  const queue = useFunscriptPlayerStore(s => s.queue)
  const playing = useFunscriptPlayerStore(s => s.playing)
  const currentTime = useFunscriptPlayerStore(s => s.currentTime)
  const duration = useFunscriptPlayerStore(s => s.duration)
  const loop = useFunscriptPlayerStore(s => s.loop)
  const shuffle = useFunscriptPlayerStore(s => s.shuffle)
  const compatibilityWarning = useFunscriptPlayerStore(s => s.compatibilityWarning)
  const dockHidden = useFunscriptPlayerStore(s => s.dockHidden)
  const dockEdge = useFunscriptPlayerStore(s => s.dockEdge)
  const dockOffset = useFunscriptPlayerStore(s => s.dockOffset)
  const play = useFunscriptPlayerStore(s => s.play)
  const pause = useFunscriptPlayerStore(s => s.pause)
  const seek = useFunscriptPlayerStore(s => s.seek)
  const next = useFunscriptPlayerStore(s => s.next)
  const previous = useFunscriptPlayerStore(s => s.previous)
  const stopOutput = useFunscriptPlayerStore(s => s.stopOutput)
  const setLoop = useFunscriptPlayerStore(s => s.setLoop)
  const setShuffle = useFunscriptPlayerStore(s => s.setShuffle)
  const setDockHidden = useFunscriptPlayerStore(s => s.setDockHidden)
  const setDockPosition = useFunscriptPlayerStore(s => s.setDockPosition)
  const device = useDeviceStore(s => s.status) === 'connected'
  const dragRef = useRef(null)

  if (!current && !queue.length) return null

  const handleTabPointerDown = event => {
    event.currentTarget.setPointerCapture?.(event.pointerId)
    dragRef.current = { x: event.clientX, y: event.clientY, moved: false }
    const onMove = moveEvent => {
      const state = dragRef.current
      if (!state) return
      if (Math.abs(moveEvent.clientX - state.x) + Math.abs(moveEvent.clientY - state.y) > 5) state.moved = true
      if (!state.moved) return
      const width = window.innerWidth || 1
      const height = window.innerHeight || 1
      const distances = [
        { edge: 'left', distance: moveEvent.clientX },
        { edge: 'right', distance: width - moveEvent.clientX },
        { edge: 'top', distance: moveEvent.clientY },
        { edge: 'bottom', distance: height - moveEvent.clientY },
      ].sort((a, b) => a.distance - b.distance)
      const edge = distances[0].edge
      const offset = edge === 'left' || edge === 'right' ? (moveEvent.clientY / height) * 100 : (moveEvent.clientX / width) * 100
      setDockPosition(edge, offset)
    }
    const onUp = () => {
      if (dragRef.current && !dragRef.current.moved) setDockHidden(false)
      dragRef.current = null
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp, { once: true })
  }

  if (dockHidden) return <button type="button" className="fs-dock-tab" style={hiddenTabStyle(dockEdge, dockOffset)} title="Show independent funscript player" aria-label="Show independent funscript player" onPointerDown={handleTabPointerDown}><GripVertical size={17} /></button>

  const title = current?.title || current?.name || 'Funscript'
  return <section className="fs-dock" style={panelStyle} aria-label="Independent funscript player">
    <div className="fs-dock-row">
      <div className="fs-dock-title"><Volume2 size={18} /><span title={title}>{title}</span><small>{device ? 'Device connected' : 'Device disconnected'} · {queue.length} queued</small></div>
      <IconButton title="Previous script" onClick={previous} disabled={!queue.length}><SkipBack size={20} /></IconButton>
      <IconButton title={playing ? 'Pause script' : 'Play script'} onClick={playing ? pause : play} disabled={!payload} active={playing}>{playing ? <Pause size={21} /> : <Play size={21} />}</IconButton>
      <IconButton title="Next script" onClick={next} disabled={!queue.length}><SkipForward size={20} /></IconButton>
      <div className="fs-dock-track"><Waveform payload={payload} currentTime={currentTime} duration={duration} /><div><span>{formatTime(currentTime)}</span><span>{formatTime(duration)}</span></div></div>
      <IconButton title="Loop script" onClick={() => setLoop(!loop)} active={loop}><Repeat size={19} /></IconButton>
      <IconButton title="Shuffle queue" onClick={() => setShuffle(!shuffle)} active={shuffle}><Shuffle size={19} /></IconButton>
      <IconButton title="Stop device output (keeps connection)" onClick={stopOutput}><CircleStop size={20} color="var(--c-pink, #D4537E)" /></IconButton>
      <IconButton title="Hide player" onClick={() => setDockHidden(true)}><X size={19} /></IconButton>
    </div>
    <input aria-label="Script position" type="range" min="0" max={Math.max(duration, 0.01)} step="0.01" value={Math.min(currentTime, duration || 0)} onChange={e => seek(Number(e.target.value))} className="fs-dock-seek" />
    {compatibilityWarning && <div className="fs-dock-warning">{compatibilityWarning}</div>}
  </section>
}

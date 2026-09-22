import { useEffect, useRef, useState } from 'react'
import { Maximize2, RotateCcw, X, ZoomIn, ZoomOut } from 'lucide-react'
import TCGV2CardFace from '../tcg-v2/TCGV2CardFace'
import './CardFocusViewer.css'

const DEFAULT_ROTATION = Object.freeze({ x: -4, y: 8 })
const MIN_ZOOM = 0.78
const MAX_ZOOM = 1.28

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

export default function CardFocusViewer({ card, title, onClose }) {
  const viewerRef = useRef(null)
  const dragRef = useRef(null)
  const [rotation, setRotation] = useState(DEFAULT_ROTATION)
  const [zoom, setZoom] = useState(1)

  const reset = () => {
    setRotation(DEFAULT_ROTATION)
    setZoom(1)
  }

  useEffect(() => {
    viewerRef.current?.focus()
    const onKeyDown = event => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      } else if (event.key.toLowerCase() === 'r') {
        event.preventDefault()
        reset()
      } else if (event.key === '+' || event.key === '=') {
        event.preventDefault()
        setZoom(value => clamp(value + 0.08, MIN_ZOOM, MAX_ZOOM))
      } else if (event.key === '-' || event.key === '_') {
        event.preventDefault()
        setZoom(value => clamp(value - 0.08, MIN_ZOOM, MAX_ZOOM))
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault()
        setRotation(value => ({ ...value, y: value.y + (event.key === 'ArrowLeft' ? -5 : 5) }))
      } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        event.preventDefault()
        setRotation(value => ({ ...value, x: value.x + (event.key === 'ArrowUp' ? -5 : 5) }))
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const onPointerDown = event => {
    if (event.button !== 0) return
    event.currentTarget.setPointerCapture?.(event.pointerId)
    dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, rotation }
  }

  const onPointerMove = event => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    setRotation({
      x: clamp(drag.rotation.x + (event.clientY - drag.y) * 0.24, -34, 34),
      y: clamp(drag.rotation.y + (event.clientX - drag.x) * 0.24, -34, 34),
    })
  }

  const stopDragging = event => {
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null
  }

  const onWheel = event => {
    event.preventDefault()
    setZoom(value => clamp(value - event.deltaY * 0.0008, MIN_ZOOM, MAX_ZOOM))
  }

  return (
    <div className="tcg-room-card-focus" role="dialog" aria-modal="true" aria-label={`${title || 'Card'} focus viewer`}>
      <div
        ref={viewerRef}
        className="tcg-room-card-focus__surface"
        tabIndex={-1}
        onKeyDown={event => {
          if (event.key === 'Escape') {
            event.stopPropagation()
            onClose()
          }
        }}
      >
        <header className="tcg-room-card-focus__header">
          <div>
            <strong>Card Focus</strong>
            <span>{title || 'Selected card'}</span>
          </div>
          <button type="button" className="tcg-room-card-focus__close" onClick={onClose} aria-label="Close card focus viewer">
            <X size={22} />
          </button>
        </header>
        <div className="tcg-room-card-focus__stage" onWheel={onWheel}>
          <div
            className="tcg-room-card-focus__card"
            style={{ transform: `scale(${zoom}) rotateX(${rotation.x}deg) rotateY(${rotation.y}deg)` }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={stopDragging}
            onPointerCancel={stopDragging}
            onPointerLeave={stopDragging}
            role="img"
            aria-label="Drag to tilt the selected card"
          >
            <TCGV2CardFace card={card} width="100%" showEffects interactive />
          </div>
        </div>
        <footer className="tcg-room-card-focus__controls" aria-label="Card focus controls">
          <button type="button" onClick={() => setZoom(value => clamp(value - 0.08, MIN_ZOOM, MAX_ZOOM))} aria-label="Zoom out"><ZoomOut size={18} /></button>
          <button type="button" onClick={reset}><RotateCcw size={18} /> Reset</button>
          <button type="button" onClick={() => setZoom(value => clamp(value + 0.08, MIN_ZOOM, MAX_ZOOM))} aria-label="Zoom in"><ZoomIn size={18} /></button>
          <span><Maximize2 size={15} /> Drag to tilt · Wheel to zoom · Esc to close</span>
        </footer>
      </div>
    </div>
  )
}

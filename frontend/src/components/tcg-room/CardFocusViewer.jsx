import { useT } from '../../i18n'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import TCGV2CardFace from '../tcg-v2/TCGV2CardFace'
import './CardFocusViewer.css'

const DEFAULT_ROTATION = Object.freeze({ x: -4, y: 8 })
const MIN_ZOOM = 0.2
const MAX_ZOOM = 4

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function distanceBetween(first, second) {
  return Math.hypot(first.clientX - second.clientX, first.clientY - second.clientY)
}

function solveLinearSystem(matrix, values) {
  const rows = matrix.map((row, index) => [...row, values[index]])
  const size = values.length
  for (let column = 0; column < size; column += 1) {
    let pivot = column
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(rows[row][column]) > Math.abs(rows[pivot][column])) pivot = row
    }
    if (Math.abs(rows[pivot][column]) < 1e-8) return null
    ;[rows[column], rows[pivot]] = [rows[pivot], rows[column]]
    const divisor = rows[column][column]
    for (let cell = column; cell <= size; cell += 1) rows[column][cell] /= divisor
    for (let row = 0; row < size; row += 1) {
      if (row === column) continue
      const factor = rows[row][column]
      for (let cell = column; cell <= size; cell += 1) rows[row][cell] -= factor * rows[column][cell]
    }
  }
  return rows.map(row => row[size])
}

function getSurfacePointerPosition(clientX, clientY, cornerElements, fallbackElement) {
  const corners = cornerElements.map(element => {
    const rect = element?.getBoundingClientRect()
    return rect ? { x: rect.left, y: rect.top } : null
  })
  if (corners.some(point => !point)) {
    const rect = fallbackElement?.getBoundingClientRect()
    return rect?.width && rect?.height
      ? { x: (clientX - rect.left) / rect.width, y: (clientY - rect.top) / rect.height }
      : null
  }

  const minX = Math.min(...corners.map(point => point.x))
  const minY = Math.min(...corners.map(point => point.y))
  const width = Math.max(...corners.map(point => point.x)) - minX
  const height = Math.max(...corners.map(point => point.y)) - minY
  if (!width || !height) return null

  const targets = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }]
  const matrix = []
  const values = []
  corners.forEach((point, index) => {
    const x = (point.x - minX) / width
    const y = (point.y - minY) / height
    const { x: u, y: v } = targets[index]
    matrix.push([x, y, 1, 0, 0, 0, -u * x, -u * y])
    values.push(u)
    matrix.push([0, 0, 0, x, y, 1, -v * x, -v * y])
    values.push(v)
  })
  const coefficients = solveLinearSystem(matrix, values)
  if (!coefficients) return null

  const x = (clientX - minX) / width
  const y = (clientY - minY) / height
  const denominator = coefficients[6] * x + coefficients[7] * y + 1
  if (Math.abs(denominator) < 1e-8) return null
  return {
    x: (coefficients[0] * x + coefficients[1] * y + coefficients[2]) / denominator,
    y: (coefficients[3] * x + coefficients[4] * y + coefficients[5]) / denominator,
  }
}

export default function CardFocusViewer({ card, title, onClose }) {
  const t = useT()
  const viewerRef = useRef(null)
  const cardFaceRef = useRef(null)
  const cardCornerRefs = useRef([])
  const focusCardRef = useRef(null)
  const dragRef = useRef(null)
  const pendingDragVfxRef = useRef(null)
  const dragVfxFrameRef = useRef(null)
  const pointersRef = useRef(new Map())
  const pinchRef = useRef(null)
  const [rotation, setRotation] = useState(DEFAULT_ROTATION)
  const [zoom, setZoom] = useState(1)

  useLayoutEffect(() => {
    const pending = pendingDragVfxRef.current
    if (!dragRef.current || !pending) return undefined

    dragVfxFrameRef.current = requestAnimationFrame(() => {
      dragVfxFrameRef.current = null
      const latest = pendingDragVfxRef.current
      if (!dragRef.current || !latest) return
      const surfacePosition = getSurfacePointerPosition(
        latest.clientX,
        latest.clientY,
        cardCornerRefs.current,
        focusCardRef.current,
      )
      cardFaceRef.current?.updatePointerVfx(latest.clientX, latest.clientY, surfacePosition)
    })

    return () => {
      if (dragVfxFrameRef.current !== null) cancelAnimationFrame(dragVfxFrameRef.current)
      dragVfxFrameRef.current = null
    }
  }, [rotation])

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
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    pointersRef.current.set(event.pointerId, event)
    if (pointersRef.current.size === 2) {
      const [first, second] = pointersRef.current.values()
      pinchRef.current = { distance: distanceBetween(first, second), zoom }
      dragRef.current = null
      return
    }
    dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, rotation }
  }

  const onPointerMove = event => {
    if (!pointersRef.current.has(event.pointerId)) return
    event.preventDefault()
    pointersRef.current.set(event.pointerId, event)
    if (pointersRef.current.size === 2 && pinchRef.current) {
      const [first, second] = pointersRef.current.values()
      const scale = distanceBetween(first, second) / pinchRef.current.distance
      setZoom(clamp(pinchRef.current.zoom * scale, MIN_ZOOM, MAX_ZOOM))
      const surfacePosition = getSurfacePointerPosition(
        event.clientX,
        event.clientY,
        cardCornerRefs.current,
        event.currentTarget,
      )
      cardFaceRef.current?.updatePointerVfx(event.clientX, event.clientY, surfacePosition)
      return
    }
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) {
      const surfacePosition = getSurfacePointerPosition(
        event.clientX,
        event.clientY,
        cardCornerRefs.current,
        event.currentTarget,
      )
      cardFaceRef.current?.updatePointerVfx(event.clientX, event.clientY, surfacePosition)
      return
    }
    pendingDragVfxRef.current = {
      clientX: event.clientX,
      clientY: event.clientY,
    }
    setRotation({
      x: drag.rotation.x + (event.clientY - drag.y) * 0.24,
      y: drag.rotation.y + (event.clientX - drag.x) * 0.24,
    })
  }

  const stopDragging = event => {
    pointersRef.current.delete(event.pointerId)
    if (pointersRef.current.size < 2) pinchRef.current = null
    if (dragRef.current?.pointerId === event.pointerId) {
      dragRef.current = null
      pendingDragVfxRef.current = null
      if (dragVfxFrameRef.current !== null) cancelAnimationFrame(dragVfxFrameRef.current)
      dragVfxFrameRef.current = null
    }
  }

  const onPointerCancel = event => {
    stopDragging(event)
    cardFaceRef.current?.resetPointerVfx()
  }

  const onWheel = event => {
    event.preventDefault()
    setZoom(value => clamp(value - event.deltaY * 0.0008, MIN_ZOOM, MAX_ZOOM))
  }

  return (
    <div
      className="tcg-room-card-focus"
      role="dialog"
      aria-modal="true"
      aria-label={`${title || 'Card'} focus viewer`}
      onClick={event => { if (event.target === event.currentTarget) onClose() }}
    >
      <button
        type="button"
        className="tcg-room-card-focus__close"
        onClick={onClose}
        aria-label={t("Close card focus viewer")}
      >
        <X size={24} aria-hidden="true" />
      </button>
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
        <div className="tcg-room-card-focus__stage" onWheel={onWheel}>
          <div
            ref={focusCardRef}
            className="tcg-room-card-focus__card"
            style={{ transform: `scale(${zoom}) rotateX(${rotation.x}deg) rotateY(${rotation.y}deg)` }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={stopDragging}
            onPointerCancel={onPointerCancel}
            onPointerLeave={() => cardFaceRef.current?.resetPointerVfx()}
            onDragStart={event => { event.preventDefault(); event.stopPropagation() }}
            role="img"
            aria-label={t("Drag to tilt the selected card")}
          >
            <span className="tcg-room-card-focus__coordinate-corner" ref={element => { cardCornerRefs.current[0] = element }} style={{ top: 0, left: 0 }} aria-hidden="true" />
            <span className="tcg-room-card-focus__coordinate-corner" ref={element => { cardCornerRefs.current[1] = element }} style={{ top: 0, right: 0 }} aria-hidden="true" />
            <span className="tcg-room-card-focus__coordinate-corner" ref={element => { cardCornerRefs.current[2] = element }} style={{ right: 0, bottom: 0 }} aria-hidden="true" />
            <span className="tcg-room-card-focus__coordinate-corner" ref={element => { cardCornerRefs.current[3] = element }} style={{ bottom: 0, left: 0 }} aria-hidden="true" />
            <div className="tcg-room-card-focus__card-inner">
              <div className="tcg-room-card-focus__face tcg-room-card-focus__face--front">
                <TCGV2CardFace ref={cardFaceRef} card={card} width="100%" showEffects interactive videoPresentation="full" disablePointerTilt idleEffects />
              </div>
              <div className="tcg-room-card-focus__face tcg-room-card-focus__face--back" aria-hidden="true">
                <img src="/card-back.png" alt="" draggable="false" onDragStart={event => event.preventDefault()} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

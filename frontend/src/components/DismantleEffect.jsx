import React, { useEffect, useRef } from 'react'

const TRAIL_LEN          = 5
const BURST_MS           = 22
const PARTICLES_PER_CARD = 40
const TRAVEL_MS_MIN      = 800   // fastest a particle can travel
const TRAVEL_MS_MAX      = 1100  // slowest — all arrive within this hard cap

function hsl(hue) { return `hsl(${hue % 360}, 100%, 65%)` }

// Ease-in-out cubic: slow start, fast middle, slow arrival
function easeInOut(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2
}

function makeParticle(rect, index, total) {
  const x     = rect.left + Math.random() * rect.width
  const y     = rect.top  + Math.random() * rect.height
  const angle = Math.random() * Math.PI * 2
  const speed = 2 + Math.random() * 4
  return {
    x, y,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed - 0.8,
    hue: (index / total) * 360 + Math.random() * 25,
    size: 2.5 + Math.random() * 2,
    initialSize: 0,  // set when travel starts
    trail: [],
    phase: 'burst',
    burstEnd: performance.now() + BURST_MS * (0.7 + Math.random() * 0.6),
    // bezier fields — set when burst ends
    startX: 0, startY: 0,
    cpX: 0, cpY: 0,
    travelStart: 0,
    travelDuration: 0,
  }
}

export default function DismantleEffect({ cardRects, targetRect, onProgress, onComplete }) {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !cardRects?.length || !targetRect) return

    canvas.width  = window.innerWidth
    canvas.height = window.innerHeight
    const ctx     = canvas.getContext('2d')

    const particles = []
    cardRects.forEach(rect => {
      for (let i = 0; i < PARTICLES_PER_CARD; i++) {
        particles.push(makeParticle(rect, i, PARTICLES_PER_CARD))
      }
    })

    const total = particles.length
    const tx    = targetRect.left + targetRect.width  / 2
    const ty    = targetRect.top  + targetRect.height / 2

    let arrivedCount = 0
    let lastReported = 0
    let raf  = null
    let done = false

    const tick = (ts) => {
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      let remaining = 0

      particles.forEach(p => {
        if (p.phase === 'arrived') return
        remaining++

        if (p.phase === 'burst') {
          p.vy += 0.25
          p.x  += p.vx
          p.y  += p.vy

          if (ts >= p.burstEnd) {
            // Lock in start position after burst, compute bezier control point.
            // Organic variation comes from the curve shape, not travel speed.
            const dx    = tx - p.x
            const dy    = ty - p.y
            const len   = Math.sqrt(dx * dx + dy * dy)
            // Perpendicular offset — random arc that bulges left or right
            const perpX = (-dy / len) * (Math.random() - 0.5) * len * 0.6
            const perpY = ( dx / len) * (Math.random() - 0.5) * len * 0.6
            p.startX = p.x
            p.startY = p.y
            p.cpX    = (p.x + tx) / 2 + perpX
            p.cpY    = (p.y + ty) / 2 + perpY
            p.initialSize    = p.size
            p.travelStart    = ts
            p.travelDuration = TRAVEL_MS_MIN + Math.random() * (TRAVEL_MS_MAX - TRAVEL_MS_MIN)
            p.phase = 'travel'
          }
        } else {
          // Time-based bezier — position is purely a function of elapsed time.
          // No physics accumulation means no drift or slow-down surprises.
          const raw    = (ts - p.travelStart) / p.travelDuration
          const t      = Math.min(raw, 1)
          const e      = easeInOut(t)
          const u      = 1 - e

          p.x    = u * u * p.startX + 2 * u * e * p.cpX + e * e * tx
          p.y    = u * u * p.startY + 2 * u * e * p.cpY + e * e * ty
          p.size = p.initialSize * (1 - t * 0.55)

          if (t >= 1) {
            p.phase = 'arrived'
            arrivedCount++
            const fraction = arrivedCount / total
            if (fraction - lastReported >= 0.02) {
              lastReported = fraction
              onProgress?.(fraction)
            }
            return
          }
        }

        // Trail
        p.trail.push({ x: p.x, y: p.y })
        if (p.trail.length > TRAIL_LEN) p.trail.shift()
        p.trail.forEach((pt, i) => {
          ctx.save()
          ctx.globalAlpha = (i + 1) / TRAIL_LEN * 0.28
          ctx.fillStyle   = hsl(p.hue + i * 12)
          ctx.beginPath()
          ctx.arc(pt.x, pt.y, Math.max(0.5, p.size * ((i + 1) / TRAIL_LEN)), 0, Math.PI * 2)
          ctx.fill()
          ctx.restore()
        })

        // Particle glow
        ctx.save()
        ctx.globalAlpha = 1
        ctx.shadowBlur  = p.size * 4
        ctx.shadowColor = hsl(p.hue)
        ctx.fillStyle   = hsl(p.hue)
        ctx.beginPath()
        ctx.arc(p.x, p.y, Math.max(0.5, p.size), 0, Math.PI * 2)
        ctx.fill()
        ctx.restore()
      })

      if (remaining === 0 && !done) {
        done = true
        onProgress?.(1)

        let alpha = 1
        const flash = () => {
          ctx.clearRect(0, 0, canvas.width, canvas.height)
          if (alpha > 0) {
            for (let h = 0; h < 360; h += 45) {
              ctx.save()
              ctx.globalAlpha = alpha * 0.7
              ctx.shadowBlur  = 24
              ctx.shadowColor = hsl(h)
              ctx.fillStyle   = hsl(h)
              ctx.beginPath()
              ctx.arc(
                tx + Math.cos((h * Math.PI) / 180) * 14 * (1 - alpha),
                ty + Math.sin((h * Math.PI) / 180) * 14 * (1 - alpha),
                4 * alpha, 0, Math.PI * 2,
              )
              ctx.fill()
              ctx.restore()
            }
            ctx.save()
            ctx.globalAlpha = alpha * 0.85
            ctx.shadowBlur  = 36
            ctx.shadowColor = '#fff'
            ctx.fillStyle   = '#fff'
            ctx.beginPath()
            ctx.arc(tx, ty, 9 * alpha, 0, Math.PI * 2)
            ctx.fill()
            ctx.restore()
            alpha -= 0.07
            requestAnimationFrame(flash)
          } else {
            ctx.clearRect(0, 0, canvas.width, canvas.height)
            onComplete?.()
          }
        }
        requestAnimationFrame(flash)
        return
      }

      raf = requestAnimationFrame(tick)
    }

    raf = requestAnimationFrame(tick)
    return () => { if (raf) cancelAnimationFrame(raf) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <canvas
      ref={canvasRef}
      style={{ position: 'fixed', inset: 0, zIndex: 2000, pointerEvents: 'none' }}
    />
  )
}

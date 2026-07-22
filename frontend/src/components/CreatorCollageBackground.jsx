// CreatorCollageBackground
//
// Pinned backdrop for the Hall of Fame: a loose scatter of the current #1
// creator's best photos that slowly float across the screen AND rotate — each
// slot cross-fades to a new photo every 10–30s (random per slot, staggered).
// Selection is 70% top images / 30% random. Tiles are opaque (clean overlap,
// no muddy alpha blend) and each slot has a fixed orientation; swaps are
// orientation-matched so the layout never reflows. Reseeds on reopen or when
// your #1 changes.
//
// Performance: blur is baked into each <img> once; the float animates only the
// tile's TRANSLATE (compositor), and swaps use a CSS opacity crossfade with
// staggered async decodes — no framer-motion, no per-frame re-blur.

import { useEffect, useRef, useState, useCallback } from 'react'
import { creatorsApi } from '../lib/api'

// Loose 3-row × 5-column scatter (% of the pinned viewport). `orient` fixes each
// slot's shape so rotating photos never resize the tile. ~4 landscape for variety.
const TILE_LAYOUT = [
  { top: '1%',  left: '-3%', width: '21vw', orient: 'portrait'  },
  { top: '3%',  left: '18%', width: '19vw', orient: 'portrait'  },
  { top: '0%',  left: '39%', width: '22vw', orient: 'landscape' },
  { top: '2%',  left: '62%', width: '19vw', orient: 'portrait'  },
  { top: '1%',  left: '80%', width: '21vw', orient: 'portrait'  },
  { top: '36%', left: '6%',  width: '20vw', orient: 'portrait'  },
  { top: '38%', left: '27%', width: '22vw', orient: 'landscape' },
  { top: '35%', left: '49%', width: '21vw', orient: 'portrait'  },
  { top: '37%', left: '70%', width: '19vw', orient: 'portrait'  },
  { top: '36%', left: '87%', width: '20vw', orient: 'portrait'  },
  { top: '68%', left: '-3%', width: '21vw', orient: 'portrait'  },
  { top: '70%', left: '18%', width: '22vw', orient: 'landscape' },
  { top: '67%', left: '40%', width: '20vw', orient: 'portrait'  },
  { top: '69%', left: '62%', width: '22vw', orient: 'landscape' },
  { top: '68%', left: '82%', width: '21vw', orient: 'portrait'  },
]

// Slow float — TRANSLATE ONLY, in VIEWPORT units so the movement is visible.
const DRIFT_CSS = `
@keyframes cdrift0 { from { transform: translate(-2vw,-1vh);    } to { transform: translate(2vw,1.5vh);   } }
@keyframes cdrift1 { from { transform: translate(2vw,-1.5vh);   } to { transform: translate(-1.5vw,2vh);  } }
@keyframes cdrift2 { from { transform: translate(-1.5vw,1.5vh); } to { transform: translate(2vw,-1.5vh);  } }
@keyframes cdrift3 { from { transform: translate(1.5vw,2vh);    } to { transform: translate(-2vw,-1vh);   } }
@keyframes cdrift4 { from { transform: translate(-1vw,-2vh);    } to { transform: translate(2vw,1vh);     } }
@keyframes collageFade { from { opacity: 0; } to { opacity: 1; } }
`
const DRIFT_DURATIONS = [55, 70, 48, 62, 58]

const FADE_MS = 1800
const SWAP_MIN_MS = 10000
const SWAP_MAX_MS = 30000

const imgStyle = (photo) => ({
  position: 'absolute',
  inset: 0,
  width: '100%',
  height: '100%',
  objectFit: 'cover',
  objectPosition: `${(photo.focal_x ?? 0.5) * 100}% ${(photo.focal_y ?? 0.5) * 100}%`,
  filter: 'blur(2px)',
})

// One scatter tile — self-schedules its own crossfade swaps.
function CollageTile({ layout, animation, pick }) {
  const [current, setCurrent] = useState(() => pick())
  const [previous, setPrevious] = useState(null)
  const currentRef = useRef(current)
  const cleanupRef = useRef(null)

  useEffect(() => { currentRef.current = current }, [current])

  useEffect(() => {
    let cancelled = false
    let timer = null
    const schedule = () => {
      const delay = SWAP_MIN_MS + Math.random() * (SWAP_MAX_MS - SWAP_MIN_MS)
      timer = setTimeout(() => {
        if (cancelled) return
        const next = pick()
        if (next) {
          setPrevious(currentRef.current)   // keep old underneath while new fades in
          setCurrent(next)
          clearTimeout(cleanupRef.current)
          cleanupRef.current = setTimeout(() => { if (!cancelled) setPrevious(null) }, FADE_MS + 100)
        }
        schedule()
      }, delay)
    }
    schedule()
    return () => {
      cancelled = true
      clearTimeout(timer)
      clearTimeout(cleanupRef.current)
    }
  }, [pick])

  if (!current) return null

  return (
    <div
      style={{
        position: 'absolute',
        top: layout.top,
        left: layout.left,
        width: layout.width,
        aspectRatio: layout.orient === 'landscape' ? '4 / 3' : '3 / 4',
        borderRadius: '14px',
        overflow: 'hidden',
        willChange: 'transform',
        backfaceVisibility: 'hidden',
        boxShadow: '0 8px 40px rgba(0,0,0,0.4)',
        animation,
      }}
    >
      {/* Outgoing photo stays at full opacity underneath until the fade finishes */}
      {previous && (
        <img key={`p-${previous.id}`} src={`/api/images/${previous.id}/thumb`} alt=""
             decoding="async" onError={(e) => { e.currentTarget.style.visibility = 'hidden' }}
             style={imgStyle(previous)} />
      )}
      {/* Incoming photo fades in on top */}
      <img key={`c-${current.id}`} src={`/api/images/${current.id}/thumb`} alt=""
           loading="lazy" decoding="async"
           onError={(e) => { e.currentTarget.style.visibility = 'hidden' }}
           style={{ ...imgStyle(current), animation: `collageFade ${FADE_MS}ms ease forwards` }} />
    </div>
  )
}

export default function CreatorCollageBackground({ creatorId, className }) {
  // Per-slot photo pools (orientation-matched) + a 70/30 picker, rebuilt per creator.
  const [slots, setSlots] = useState([])

  useEffect(() => {
    if (!creatorId) {
      setSlots([])
      return
    }
    let cancelled = false
    creatorsApi.collage(creatorId, 40).then((res) => {
      if (cancelled) return
      const pool = Array.isArray(res.data) ? res.data : []   // top-first from the API
      if (pool.length === 0) {
        setSlots([])
        return
      }
      const portraitPool  = pool.filter((p) => p.portrait)
      const landscapePool = pool.filter((p) => !p.portrait)

      const built = TILE_LAYOUT.map((layout) => {
        // Prefer the slot's designed orientation, but fall back if that pool is thin.
        let usePool = layout.orient === 'landscape' && landscapePool.length >= 2 ? landscapePool : portraitPool
        let orient = usePool === landscapePool ? 'landscape' : 'portrait'
        if (usePool.length === 0) { usePool = pool; orient = layout.orient }
        const topCount = Math.max(4, Math.ceil(usePool.length * 0.4))
        // 70% from the top slice, 30% from anywhere in this slot's pool
        const pick = () => {
          const src = Math.random() < 0.7 ? usePool.slice(0, topCount) : usePool
          return src[Math.floor(Math.random() * src.length)]
        }
        return { layout: { ...layout, orient }, pick }
      })
      setSlots(built)
    }).catch(() => { if (!cancelled) setSlots([]) })
    return () => { cancelled = true }
  }, [creatorId])

  if (!creatorId) return null

  return (
    <div
      className={className}
      style={{
        position: 'absolute',
        inset: 0,
        overflow: 'hidden',
        pointerEvents: 'none',
        zIndex: 0,
        contain: 'layout paint',
      }}
    >
      <style>{DRIFT_CSS}</style>

      {slots.map((slot, i) => (
        <CollageTile
          key={`${creatorId}-${i}`}
          layout={slot.layout}
          pick={slot.pick}
          animation={`cdrift${i % 5} ${DRIFT_DURATIONS[i % DRIFT_DURATIONS.length]}s ease-in-out ${-(i * 7)}s infinite alternate`}
        />
      ))}

      {/* Single dark scrim on top (one layer → no muddy alpha-mixing) +
          a soft vignette for depth and readable edges. */}
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(14,14,14,0.42)' }} />
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: 'radial-gradient(ellipse at center, transparent 30%, rgba(14,14,14,0.55) 100%)',
        }}
      />
    </div>
  )
}

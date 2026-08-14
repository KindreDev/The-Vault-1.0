/**
 * <HofFullListModal /> — "Know more" for a Hall of Fame section.
 *
 * Each HOF section shows only its top few entries. This opens the rest as one
 * infinite-scrolling ranked list. Clicking a creator row hands the id back up
 * so the page can open the same detailed stats modal you get from the podium.
 */
import React, { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Eye, Droplets, Clock, TrendingUp, ArrowUp, ArrowDown, Loader2, Waves, Heart } from 'lucide-react'

const PAGE_SIZE = 30

function fmtTime(secs) {
  if (!secs || secs <= 0) return null
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`
  return `${m}m`
}

/**
 * Square preview for a row. Each kind of entry has its image somewhere
 * different: a file has a thumb endpoint, a gallery has a cover, a creator has
 * an avatar. Falls back to an initial so rows never collapse.
 */
function Thumb({ item }) {
  const [failed, setFailed] = useState(false)
  const SIZE = 44

  let src = null
  if (item.filename && item.gallery_id != null) src = `/api/images/${item.id}/thumb`   // photo / video
  else if (item.cover_thumb)                    src = item.cover_thumb                 // gallery
  else if (item.avatar_path)                                                            // creator
    src = `/api/creators/${item.id}/avatar-thumb?size=96&v=${encodeURIComponent(String(item.avatar_path).split(/[\\/]/).pop() || '')}`

  if (!src || failed) {
    const label = (item.name || item.filename || '?').trim().charAt(0).toUpperCase()
    return (
      <div className="rounded-[6px] flex items-center justify-center flex-shrink-0"
           style={{ width: SIZE, height: SIZE, background: 'rgba(255,255,255,0.06)',
                    color: 'rgba(255,255,255,0.3)', fontSize: 18, fontWeight: 700 }}>
        {label}
      </div>
    )
  }
  return (
    <img src={src} alt="" onError={() => setFailed(true)}
         className="rounded-[6px] flex-shrink-0"
         style={{ width: SIZE, height: SIZE, objectFit: 'cover',
                  border: '0.5px solid rgba(255,255,255,0.08)' }} />
  )
}

function Movement({ change }) {
  if (!change) return null
  const up = change > 0
  const color = up ? 'var(--c-green)' : 'var(--c-pink)'
  const Icon = up ? ArrowUp : ArrowDown
  return (
    <span className="flex items-center gap-0.5 flex-shrink-0"
          style={{ fontSize: 16, fontWeight: 700, color }}
          title={`${up ? 'Climbed' : 'Dropped'} ${Math.abs(change)} place${Math.abs(change) === 1 ? '' : 's'}`}>
      <Icon size={14} /> {Math.abs(change)}
    </span>
  )
}

export default function HofFullListModal({
  open,
  title,
  subtitle,
  fetchPage,        // (limit, offset) => Promise<Array>
  renderRow,        // optional custom row renderer
  onRowClick,       // (item) => void
  onClose,
}) {
  const [items, setItems]     = useState([])
  const [loading, setLoading] = useState(false)
  const [done, setDone]       = useState(false)
  const sentinelRef = useRef(null)
  const scrollRef   = useRef(null)
  // Guards against a second fetch firing while one is already in flight — the
  // sentinel can intersect repeatedly during fast scrolling.
  const busyRef = useRef(false)

  // Reset whenever the modal is opened, so switching sections doesn't show
  // the previous section's rows.
  useEffect(() => {
    if (!open) return
    setItems([]); setDone(false); busyRef.current = false
  }, [open, fetchPage])

  const loadMore = useCallback(async () => {
    if (busyRef.current || done) return
    busyRef.current = true
    setLoading(true)
    try {
      const offset = items.length
      const batch  = await fetchPage(PAGE_SIZE, offset)
      const rows   = batch || []
      if (rows.length < PAGE_SIZE) setDone(true)
      setItems(prev => {
        // De-duplicate defensively: a rank shift between pages could otherwise
        // repeat an entry and break React keys.
        const seen = new Set(prev.map(p => p.id))
        return [...prev, ...rows.filter(r => !seen.has(r.id))]
      })
    } catch (_) {
      setDone(true)
    } finally {
      setLoading(false)
      busyRef.current = false
    }
  }, [items.length, done, fetchPage])

  // First page on open
  useEffect(() => {
    if (open && items.length === 0 && !done) loadMore()
  }, [open, items.length, done, loadMore])

  // Infinite scroll
  useEffect(() => {
    if (!open) return
    const el = sentinelRef.current
    if (!el) return
    const io = new IntersectionObserver(
      entries => { if (entries[0].isIntersecting) loadMore() },
      { root: scrollRef.current, rootMargin: '200px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [open, loadMore])

  // Escape closes
  useEffect(() => {
    if (!open) return
    const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, onClose])

  if (!open) return null

  return createPortal(
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        transition={{ duration: 0.18 }}
        className="fixed inset-0 z-[10000] flex items-center justify-center p-6"
        style={{ background: 'rgba(0,0,0,0.75)' }}
        onClick={onClose}>
        <motion.div
          initial={{ y: 12 }} animate={{ y: 0 }} exit={{ y: 8 }}
          transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
          onClick={e => e.stopPropagation()}
          className="rounded-[16px] overflow-hidden flex flex-col w-full"
          style={{ maxWidth: 760, maxHeight: '85vh',
                   background: 'var(--c-card, #1e1e1e)',
                   border: '0.5px solid rgba(255,255,255,0.1)',
                   boxShadow: '0 24px 80px rgba(0,0,0,0.6)' }}>

          <div className="flex items-start justify-between gap-4 px-6 py-5"
               style={{ borderBottom: '0.5px solid rgba(255,255,255,0.08)' }}>
            <div>
              <div style={{ fontSize: 22, fontWeight: 700, color: 'rgba(255,255,255,0.9)' }}>{title}</div>
              {subtitle && (
                <div style={{ fontSize: 16, color: 'rgba(255,255,255,0.35)', marginTop: 2 }}>{subtitle}</div>
              )}
            </div>
            <button onClick={onClose}
                    className="p-2 rounded-lg cursor-pointer transition-colors hover:bg-white/10"
                    style={{ color: 'rgba(255,255,255,0.5)' }}>
              <X size={18} />
            </button>
          </div>

          <div ref={scrollRef} className="overflow-y-auto flex-1">
            {items.map(item => (
              renderRow ? (
                <div key={item.id}>{renderRow(item)}</div>
              ) : (
                <button
                  key={item.id}
                  onClick={() => onRowClick?.(item)}
                  className="w-full flex items-center gap-4 px-6 py-3 text-left cursor-pointer transition-colors hover:bg-white/[0.04]"
                  style={{ borderBottom: '0.5px solid rgba(255,255,255,0.05)' }}>
                  <span className="font-mono flex-shrink-0 text-right"
                        style={{ fontSize: 16, width: 38, color: 'rgba(255,255,255,0.3)' }}>
                    {item.rank}
                  </span>
                  {/* A filename alone tells you nothing about what you're
                      looking at — show the actual thing. */}
                  <Thumb item={item} />
                  <span className="flex-1 min-w-0 truncate"
                        style={{ fontSize: 17, color: 'rgba(255,255,255,0.85)' }}>
                    {item.name || item.filename}
                  </span>
                  <Movement change={item.rank_change} />
                  <span className="flex items-center gap-3 flex-shrink-0">
                    {(item.total_views ?? item.view_count) > 0 && (
                      <span className="flex items-center gap-1" style={{ fontSize: 16, color: 'rgba(255,255,255,0.4)' }}>
                        <Eye size={13} /> {(item.total_views ?? item.view_count).toLocaleString()}
                      </span>
                    )}
                    {(item.total_cum ?? item.cum_count) > 0 && (
                      <span className="flex items-center gap-1" style={{ fontSize: 16, color: 'var(--c-pink)' }}>
                        <Droplets size={13} /> {(item.total_cum ?? item.cum_count).toLocaleString()}
                      </span>
                    )}
                    {item.total_edges > 0 && (
                      <span className="flex items-center gap-1" style={{ fontSize: 16, color: '#A89FE8' }}
                            title="Edges">
                        <Waves size={13} /> {item.total_edges.toLocaleString()}
                      </span>
                    )}
                    {item.session_count > 0 && (
                      <span className="flex items-center gap-1" style={{ fontSize: 16, color: '#F4C0D1' }}
                            title="Sessions logged">
                        <Heart size={13} /> {item.session_count.toLocaleString()}
                      </span>
                    )}
                    {fmtTime(item.total_view_seconds ?? item.view_seconds) && (
                      <span className="flex items-center gap-1" style={{ fontSize: 16, color: 'var(--c-accent-text)' }}>
                        <Clock size={13} /> {fmtTime(item.total_view_seconds ?? item.view_seconds)}
                      </span>
                    )}
                    {item.avg_dwell_seconds > 0 && (
                      <span className="flex items-center gap-1" style={{ fontSize: 16, color: 'var(--c-green-text)' }}
                            title="Average time you linger on one of her photos">
                        <TrendingUp size={13} /> {item.avg_dwell_seconds}s
                      </span>
                    )}
                  </span>
                </button>
              )
            ))}

            <div ref={sentinelRef} className="flex items-center justify-center py-6">
              {loading && <Loader2 size={18} className="animate-spin" style={{ color: 'rgba(255,255,255,0.3)' }} />}
              {/* Explicit fallback: if the scroll observer doesn't fire for any
                  reason, the list must still be pageable by hand. */}
              {!loading && !done && items.length > 0 && (
                <button onClick={loadMore}
                        className="px-4 py-2 rounded-lg cursor-pointer transition-colors hover:bg-white/10"
                        style={{ fontSize: 16, color: 'rgba(255,255,255,0.45)',
                                 background: 'rgba(255,255,255,0.04)',
                                 border: '0.5px solid rgba(255,255,255,0.1)' }}>
                  Load more
                </button>
              )}
              {done && items.length > 0 && (
                <span style={{ fontSize: 16, color: 'rgba(255,255,255,0.2)' }}>
                  That's all {items.length}
                </span>
              )}
              {done && items.length === 0 && (
                <span style={{ fontSize: 16, color: 'rgba(255,255,255,0.25)' }}>Nothing here yet</span>
              )}
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body
  )
}

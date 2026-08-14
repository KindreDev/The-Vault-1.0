import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import { useQuery } from '@tanstack/react-query'
import { Navigate } from 'react-router-dom'
import { X, Play, Pause, ChevronLeft, ChevronRight, Sparkles } from 'lucide-react'
import { recapApi } from '../lib/api'
import RecapCard from '../components/recap/RecapCards'

const PERIODS = [
  { id: 'day',   label: 'Today',      blurb: 'The last few hours, counted' },
  { id: 'week',  label: 'This Week',  blurb: 'Since Monday' },
  { id: 'month', label: 'This Month', blurb: 'Since the 1st' },
  { id: 'year',  label: 'This Year',  blurb: 'Everything in 2026' },
  { id: 'all',   label: 'All Time',   blurb: 'From the very beginning' },
]

// The countdown arrives as one card holding five creators. It plays as five
// screens — the reveal is the only real drama the deck has, and showing the
// whole top five at once throws it away.
function flatten(cards, periodLabel) {
  const out = []
  for (const c of cards || []) {
    if (c.type === 'countdown') {
      c.creators.forEach((creator, i) => {
        out.push({ type: 'countdown', creator, place: c.creators.length - i, periodLabel,
                   key: `countdown-${creator.id}` })
      })
    } else {
      out.push({ ...c, key: c.type })
    }
  }
  return out
}

const DURATION = 6200

function Player({ deck, onClose }) {
  const cards = useMemo(() => flatten(deck.cards, deck.label), [deck])
  const [idx, setIdx] = useState(0)
  const [paused, setPaused] = useState(false)
  const startedAt = useRef(Date.now())
  const [elapsed, setElapsed] = useState(0)

  const next = useCallback(() => setIdx(i => (i + 1 <= cards.length - 1 ? i + 1 : i)), [cards.length])
  const prev = useCallback(() => setIdx(i => Math.max(0, i - 1)), [])

  // Reset the bar whenever the card changes, however it changed.
  useEffect(() => { startedAt.current = Date.now(); setElapsed(0) }, [idx])

  useEffect(() => {
    if (paused) return
    const tick = setInterval(() => {
      const e = Date.now() - startedAt.current
      setElapsed(e)
      if (e >= DURATION) {
        if (idx < cards.length - 1) { setIdx(i => i + 1) } else { setPaused(true) }
      }
    }, 60)
    return () => clearInterval(tick)
  }, [paused, idx, cards.length])

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowRight') next()
      if (e.key === 'ArrowLeft') prev()
      if (e.key === ' ') { e.preventDefault(); setPaused(p => !p) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [next, prev, onClose])

  const card = cards[idx]
  const atEnd = idx === cards.length - 1

  return createPortal(
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                style={{ position: 'fixed', inset: 0, zIndex: 200, background: '#0a0a0a',
                         display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      {/* Ambient wash so the panel doesn't sit on flat black */}
      <div aria-hidden style={{ position: 'absolute', inset: 0, pointerEvents: 'none',
             background: 'radial-gradient(circle at 30% 20%, color-mix(in srgb, var(--c-accent) 16%, transparent), transparent 55%), radial-gradient(circle at 75% 80%, color-mix(in srgb, var(--c-pink) 13%, transparent), transparent 55%)' }} />

      <div style={{ position: 'relative', width: 'min(560px, 94vw)', height: 'min(880px, 92vh)',
                    display: 'flex', flexDirection: 'column' }}>

        {/* Progress segments */}
        <div className="flex gap-1.5 px-1 pt-1">
          {cards.map((c, i) => (
            <div key={c.key + i} style={{ flex: 1, height: 3, borderRadius: 2,
                                          background: 'rgba(255,255,255,0.16)', overflow: 'hidden' }}>
              <div style={{ height: '100%', background: 'var(--c-amber-text)', borderRadius: 2,
                            width: i < idx ? '100%' : i === idx ? `${Math.min(100, (elapsed / DURATION) * 100)}%` : '0%',
                            transition: i === idx ? 'none' : 'width 0.2s' }} />
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between px-1 pt-4">
          <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: '0.1em',
                        textTransform: 'uppercase', color: 'rgba(255,255,255,0.35)' }}>
            {deck.label}
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => setPaused(p => !p)} className="p-2 rounded-lg"
                    style={{ color: 'rgba(255,255,255,0.5)' }} title={paused ? 'Play' : 'Pause'}>
              {paused ? <Play size={19} /> : <Pause size={19} />}
            </button>
            <button onClick={onClose} className="p-2 rounded-lg"
                    style={{ color: 'rgba(255,255,255,0.5)' }} title="Close (Esc)">
              <X size={21} />
            </button>
          </div>
        </div>

        {/* Card stage */}
        <div style={{ flex: 1, position: 'relative', minHeight: 0, padding: '8px 4px' }}>
          {/* Keyed remount rather than AnimatePresence: with mode="wait" the
              outgoing card's exit never completed, so it sat at opacity 0
              forever and the next card was never admitted. Nothing here needs a
              cross-fade — each card fades in on its own. */}
          <motion.div key={idx}
                      initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                      transition={{ duration: 0.3 }}
                      style={{ position: 'absolute', inset: 0, padding: '0 8px' }}>
            <RecapCard card={card} />
          </motion.div>

          {/* Tap zones — left third back, right two-thirds forward, like stories */}
          <button onClick={prev} aria-label="Previous"
                  style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: '32%', cursor: 'w-resize' }} />
          <button onClick={next} aria-label="Next"
                  style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: '68%', cursor: 'e-resize' }} />
        </div>

        <div className="flex items-center justify-between px-2 pb-2">
          <button onClick={prev} disabled={idx === 0} className="p-2"
                  style={{ color: idx === 0 ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.4)' }}>
            <ChevronLeft size={22} />
          </button>
          <span style={{ fontSize: 16, color: 'rgba(255,255,255,0.25)' }}>
            {idx + 1} / {cards.length}
          </span>
          {atEnd ? (
            <button onClick={onClose} className="px-4 py-2 rounded-[10px]"
                    style={{ fontSize: 16, fontWeight: 700, color: 'var(--c-amber-text)',
                             background: 'color-mix(in srgb, var(--c-amber) 14%, transparent)', border: '0.5px solid color-mix(in srgb, var(--c-amber) 38%, transparent)' }}>
              Done
            </button>
          ) : (
            <button onClick={next} className="p-2" style={{ color: 'rgba(255,255,255,0.4)' }}>
              <ChevronRight size={22} />
            </button>
          )}
        </div>
      </div>
    </motion.div>,
    document.body,
  )
}

function PeriodTile({ p, active, onClick }) {
  return (
    <button onClick={onClick}
            className="text-left p-6 rounded-[16px] transition-all"
            style={{ background: active ? 'color-mix(in srgb, var(--c-amber) 12%, transparent)' : 'rgba(255,255,255,0.03)',
                     border: `0.5px solid ${active ? 'color-mix(in srgb, var(--c-amber) 42%, transparent)' : 'rgba(255,255,255,0.08)'}`,
                     boxShadow: active ? '0 0 34px 3px color-mix(in srgb, var(--c-amber) 12%, transparent)' : 'none' }}>
      <div style={{ fontSize: 26, fontWeight: 800, color: active ? 'var(--c-amber-text)' : 'rgba(255,255,255,0.9)' }}>
        {p.label}
      </div>
      <div style={{ fontSize: 16, color: 'rgba(255,255,255,0.4)', marginTop: 4 }}>{p.blurb}</div>
    </button>
  )
}

export default function Recap() {
  const [period, setPeriod] = useState('month')
  const [playing, setPlaying] = useState(false)

  const { data: deck, isLoading, error } = useQuery({
    queryKey: ['recap', period],
    queryFn:  () => recapApi.get(period).then(r => r.data),
    staleTime: 30_000,
    retry: false,
  })

  // The nav hides this page until enough usage is tracked, but the URL is still
  // typeable. A 403 means the gate, not a failure — bounce rather than explain,
  // so the page gives nothing away.
  if (error?.response?.status === 403) return <Navigate to="/dashboard" replace />

  return (
    <div className="flex-1" style={{ background: '#0e0e0e', minHeight: '100%' }}>
      <div className="max-w-[1100px] mx-auto px-8 py-12">

        <div className="flex items-center gap-4 mb-10">
          <div className="flex items-center justify-center w-14 h-14 rounded-[14px]"
               style={{ background: 'color-mix(in srgb, var(--c-amber) 14%, transparent)', border: '0.5px solid color-mix(in srgb, var(--c-amber) 35%, transparent)',
                        boxShadow: '0 0 30px 4px color-mix(in srgb, var(--c-amber) 12%, transparent)' }}>
            <Sparkles size={26} style={{ color: 'var(--c-amber-text)' }} />
          </div>
          <div>
            <h1 className="text-[32px] font-bold text-[rgba(255,255,255,0.95)]">Recap</h1>
            <p className="text-[16px] text-[rgba(255,255,255,0.35)] mt-0.5">
              Your own behaviour, read back to you. Pick a window.
            </p>
          </div>
        </div>

        <div className="grid gap-4 mb-10" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
          {PERIODS.map(p => (
            <PeriodTile key={p.id} p={p} active={p.id === period} onClick={() => setPeriod(p.id)} />
          ))}
        </div>

        <div className="rounded-[18px] p-10"
             style={{ background: 'rgba(255,255,255,0.02)', border: '0.5px solid rgba(255,255,255,0.07)' }}>
          {isLoading ? (
            <div style={{ fontSize: 18, color: 'rgba(255,255,255,0.3)' }}>Reading the numbers…</div>
          ) : deck?.empty ? (
            <div style={{ fontSize: 18, color: 'rgba(255,255,255,0.35)' }}>
              Not enough logged in this window to tell a story yet.
            </div>
          ) : (
            <>
              <div style={{ fontSize: 16, letterSpacing: '0.12em', textTransform: 'uppercase',
                            color: 'rgba(255,255,255,0.35)', fontWeight: 600 }}>
                {deck?.range}
              </div>
              <div style={{ fontSize: 40, fontWeight: 800, color: '#fff', marginTop: 10, lineHeight: 1.15 }}>
                {deck?.cards?.find(c => c.type === 'closing')?.headline}
              </div>
              <div className="flex items-center gap-4 mt-8">
                <button onClick={() => setPlaying(true)}
                        className="px-6 py-3.5 rounded-[12px] flex items-center gap-2.5"
                        style={{ fontSize: 18, fontWeight: 700, color: '#0e0e0e', background: 'var(--c-amber-text)' }}>
                  <Play size={19} /> Play {deck?.label}
                </button>
                <span style={{ fontSize: 16, color: 'rgba(255,255,255,0.3)' }}>
                  {deck?.cards?.length} cards
                </span>
              </div>
            </>
          )}
        </div>
      </div>

      {playing && deck && !deck.empty && (
        <Player deck={deck} onClose={() => setPlaying(false)} />
      )}
    </div>
  )
}

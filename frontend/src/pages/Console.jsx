import React, { useState, useEffect, useRef, useCallback } from 'react'
import { Terminal, Trash2, Pause, Play, ChevronDown } from 'lucide-react'
import { systemApi } from '../lib/api'

// ── Level colours (match vault theme + user-configurable accent via CSS var) ──
const LEVEL_COLOR = {
  DEBUG:   'rgba(255,255,255,0.25)',
  INFO:    'rgba(255,255,255,0.65)',
  WARNING: '#EF9F27',
  ERROR:   '#E24B4A',
  CRITICAL:'#E24B4A',
}
const LEVEL_BG = {
  WARNING:  'rgba(239,159,39,0.07)',
  ERROR:    'rgba(226,75,74,0.07)',
  CRITICAL: 'rgba(226,75,74,0.12)',
}

const FILTERS = ['ALL', 'DEBUG', 'INFO', 'WARNING', 'ERROR']

function levelColor(lvl) { return LEVEL_COLOR[lvl] ?? LEVEL_COLOR.INFO }
function levelBg(lvl)    { return LEVEL_BG[lvl]    ?? 'transparent' }

export default function Console() {
  const [entries,   setEntries]   = useState([])
  const [filter,    setFilter]    = useState('ALL')
  const [paused,    setPaused]    = useState(false)
  const [connected, setConnected] = useState(false)

  const bottomRef    = useRef(null)
  const containerRef = useRef(null)
  const pausedRef    = useRef(false)
  const pendingRef   = useRef([])   // buffer while paused
  const userScrolled = useRef(false)
  // Track every seq we've added so REST pre-load and SSE seed never duplicate
  const seenSeqs     = useRef(new Set())

  // Keep ref in sync with state
  pausedRef.current = paused

  // ── Shared helper — add entries without duplicates ─────────────────────────
  const addEntries = useCallback((incoming) => {
    const fresh = incoming.filter(e => !seenSeqs.current.has(e.seq))
    if (fresh.length === 0) return
    fresh.forEach(e => seenSeqs.current.add(e.seq))
    setEntries(prev => {
      const combined = [...prev, ...fresh].sort((a, b) => a.seq - b.seq)
      return combined.length > 3000 ? combined.slice(combined.length - 3000) : combined
    })
  }, [])

  // ── Auto-scroll ────────────────────────────────────────────────────────────
  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'instant' })
  }, [])

  // Detect manual scroll-up → suppress auto-scroll
  const onScroll = useCallback(() => {
    const el = containerRef.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60
    userScrolled.current = !atBottom
  }, [])

  // ── REST pre-load ──────────────────────────────────────────────────────────
  // Fetch existing buffer via REST immediately on mount so entries appear even
  // if the SSE seed delivery is delayed or buffered by the runtime.
  useEffect(() => {
    systemApi.consoleEntries(500)
      .then(r => addEntries(r?.data?.entries ?? []))
      .catch(() => {})   // non-fatal — SSE handles live updates
  }, [addEntries])

  // ── SSE connection ─────────────────────────────────────────────────────────
  useEffect(() => {
    // Bypass Vite proxy in dev — it can silently buffer SSE events
    const sseBase = import.meta.env.DEV ? 'http://localhost:8000' : ''
    const es = new EventSource(`${sseBase}/api/system/console/stream`)

    es.onopen = () => setConnected(true)

    es.onmessage = (e) => {
      try {
        const entry = JSON.parse(e.data)
        if (pausedRef.current) {
          // Only buffer if we haven't seen it (the seed can race with REST pre-load)
          if (!seenSeqs.current.has(entry.seq)) {
            pendingRef.current.push(entry)
          }
        } else {
          addEntries([entry])
        }
      } catch (_) {}
    }

    es.onerror = () => setConnected(false)

    return () => { es.close(); setConnected(false) }
  }, [addEntries])

  // Auto-scroll whenever entries change (unless paused or user scrolled up)
  useEffect(() => {
    if (!paused && !userScrolled.current) scrollToBottom()
  }, [entries, paused, scrollToBottom])

  // ── Pause / resume ─────────────────────────────────────────────────────────
  const togglePause = useCallback(() => {
    setPaused(prev => {
      const next = !prev
      if (!next && pendingRef.current.length > 0) {
        const buffered = pendingRef.current
        pendingRef.current = []
        // addEntries handles dedup — entries buffered while paused may overlap
        // with what the REST pre-load already delivered
        const fresh = buffered.filter(e => !seenSeqs.current.has(e.seq))
        fresh.forEach(e => seenSeqs.current.add(e.seq))
        if (fresh.length > 0) {
          setEntries(e => {
            const combined = [...e, ...fresh].sort((a, b) => a.seq - b.seq)
            return combined.length > 3000 ? combined.slice(combined.length - 3000) : combined
          })
        }
      }
      return next
    })
  }, [])

  // ── Clear ──────────────────────────────────────────────────────────────────
  const clear = useCallback(() => {
    setEntries([])
    pendingRef.current = []
    seenSeqs.current.clear()
  }, [])

  // ── Filter ─────────────────────────────────────────────────────────────────
  const visible = filter === 'ALL'
    ? entries
    : entries.filter(e => e.level === filter)

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100%',
      background: 'var(--c-bg, #0e0e0e)', color: 'rgba(255,255,255,0.75)',
      fontFamily: "'Consolas','JetBrains Mono','Fira Code',monospace",
    }}>

      {/* ── Toolbar ── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '10px 16px',
        borderBottom: '0.5px solid rgba(255,255,255,0.08)',
        flexShrink: 0,
        background: 'var(--c-surface, #161616)',
      }}>
        <Terminal size={16} style={{ color: 'var(--accent, #7F77DD)', flexShrink: 0 }} />
        <span style={{ fontWeight: 700, fontSize: 14, color: 'rgba(255,255,255,0.85)', letterSpacing: '0.03em' }}>
          Console
        </span>

        {/* Connection dot */}
        <div style={{
          width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
          background: connected ? '#1D9E75' : '#E24B4A',
          boxShadow: connected ? '0 0 6px #1D9E7588' : '0 0 6px #E24B4A88',
          marginLeft: 2,
        }} />
        <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', marginRight: 'auto' }}>
          {connected ? 'connected' : 'disconnected'}
        </span>

        {/* Level filters */}
        <div style={{ display: 'flex', gap: 4 }}>
          {FILTERS.map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              style={{
                padding: '3px 10px', borderRadius: 6, fontSize: 11, fontWeight: 700,
                cursor: 'pointer', letterSpacing: '0.04em',
                background: filter === f
                  ? 'var(--accent, #7F77DD)'
                  : 'rgba(255,255,255,0.05)',
                color: filter === f
                  ? '#fff'
                  : 'rgba(255,255,255,0.4)',
                border: filter === f
                  ? '1px solid transparent'
                  : '1px solid rgba(255,255,255,0.08)',
                transition: 'all 0.15s ease',
              }}
            >
              {f}
            </button>
          ))}
        </div>

        {/* Pause */}
        <button
          onClick={togglePause}
          title={paused ? 'Resume' : 'Pause'}
          style={{
            padding: '3px 10px', borderRadius: 6, fontSize: 11, fontWeight: 700,
            cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5,
            background: paused ? 'rgba(239,159,39,0.15)' : 'rgba(255,255,255,0.05)',
            color:      paused ? '#EF9F27' : 'rgba(255,255,255,0.4)',
            border: paused
              ? '1px solid rgba(239,159,39,0.3)'
              : '1px solid rgba(255,255,255,0.08)',
            transition: 'all 0.15s ease',
          }}
        >
          {paused ? <Play size={11} /> : <Pause size={11} />}
          {paused ? `Resume (${pendingRef.current.length})` : 'Pause'}
        </button>

        {/* Clear */}
        <button
          onClick={clear}
          title="Clear"
          style={{
            padding: '3px 10px', borderRadius: 6, fontSize: 11,
            cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5,
            background: 'rgba(255,255,255,0.05)',
            color: 'rgba(255,255,255,0.35)',
            border: '1px solid rgba(255,255,255,0.08)',
          }}
        >
          <Trash2 size={11} /> Clear
        </button>
      </div>

      {/* ── Log lines ── */}
      <div
        ref={containerRef}
        onScroll={onScroll}
        style={{
          flex: 1, overflowY: 'auto', padding: '8px 0',
          scrollbarWidth: 'thin',
          scrollbarColor: 'rgba(255,255,255,0.12) transparent',
        }}
      >
        {visible.length === 0 ? (
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            justifyContent: 'center', height: '100%', gap: 10,
            color: 'rgba(255,255,255,0.15)', fontSize: 13,
          }}>
            <Terminal size={28} style={{ opacity: 0.2 }} />
            {connected ? 'Waiting for log output…' : 'Connecting to server…'}
          </div>
        ) : (
          visible.map(entry => (
            <div
              key={entry.seq}
              style={{
                display: 'flex', alignItems: 'flex-start', gap: 0,
                padding: '1px 16px',
                background: levelBg(entry.level),
                borderLeft: entry.level === 'WARNING' || entry.level === 'ERROR' || entry.level === 'CRITICAL'
                  ? `2px solid ${levelColor(entry.level)}44`
                  : '2px solid transparent',
              }}
            >
              {/* Timestamp */}
              <span style={{
                flexShrink: 0, fontSize: 11, color: 'rgba(255,255,255,0.2)',
                width: 64, paddingTop: 1, userSelect: 'none',
              }}>
                {entry.ts}
              </span>

              {/* Level badge */}
              <span style={{
                flexShrink: 0, fontSize: 10, fontWeight: 700,
                width: 58, paddingTop: 2, letterSpacing: '0.04em',
                color: levelColor(entry.level),
                userSelect: 'none',
              }}>
                {entry.level}
              </span>

              {/* Message */}
              <span style={{
                flex: 1, fontSize: 12, lineHeight: 1.6,
                color: levelColor(entry.level),
                wordBreak: 'break-word', whiteSpace: 'pre-wrap',
              }}>
                {entry.msg}
              </span>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>

      {/* ── Footer ── */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '5px 16px',
        borderTop: '0.5px solid rgba(255,255,255,0.06)',
        background: 'var(--c-surface, #161616)',
        flexShrink: 0,
        fontSize: 11, color: 'rgba(255,255,255,0.2)',
      }}>
        <span>{visible.length.toLocaleString()} line{visible.length !== 1 ? 's' : ''}{filter !== 'ALL' ? ` (${filter} only)` : ''}</span>

        {/* Jump to bottom */}
        {userScrolled.current && (
          <button
            onClick={() => {
              userScrolled.current = false
              scrollToBottom()
            }}
            style={{
              display: 'flex', alignItems: 'center', gap: 4,
              background: 'rgba(255,255,255,0.07)',
              border: '0.5px solid rgba(255,255,255,0.12)',
              borderRadius: 5, padding: '2px 8px',
              color: 'rgba(255,255,255,0.45)', cursor: 'pointer', fontSize: 11,
            }}
          >
            <ChevronDown size={11} /> Jump to bottom
          </button>
        )}

        <span>{paused ? '⏸ paused' : '● live'}</span>
      </div>
    </div>
  )
}

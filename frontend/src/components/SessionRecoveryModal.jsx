/**
 * Recovery prompt for a session the app was closed on top of.
 *
 * The store detects this on boot (see readSessionBoot) and does NOT resume the
 * session, because resuming it would run the clock through however long the app
 * was shut. What it offers instead is the honest number: time from the session
 * starting to the last heartbeat the app managed to write.
 *
 * The duration is editable because the heartbeat is only an upper bound — you
 * may well have stopped twenty minutes before the app did.
 */
import React, { useState } from 'react'
import ReactDOM from 'react-dom'
import { Clock, X } from 'lucide-react'
import { useVaultStore } from '../store/vault'
import { logRecoveredSession } from '../lib/session'

const fmtDuration = (ms) => {
  const total = Math.max(0, Math.round(ms / 60000))
  const h = Math.floor(total / 60)
  const m = total % 60
  if (h > 0) return `${h}h ${m}m`
  return `${m} minute${m === 1 ? '' : 's'}`
}

const fmtWhen = (ms) => new Date(ms).toLocaleString(undefined, {
  month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
})

export default function SessionRecoveryModal() {
  const stale             = useVaultStore(s => s.staleSession)
  const clearStaleSession = useVaultStore(s => s.clearStaleSession)

  // Minutes, editable. Seeded from the heartbeat estimate.
  const [minutes, setMinutes] = useState(() =>
    stale ? String(Math.max(1, Math.round(stale.elapsedMs / 60000))) : '0')
  const [busy, setBusy] = useState(false)

  if (!stale) return null

  const parsedMinutes = Math.max(0, parseInt(minutes || '0', 10) || 0)

  const keep = async () => {
    if (busy) return
    setBusy(true)
    await logRecoveredSession(parsedMinutes * 60, stale.startAt)
    clearStaleSession(parsedMinutes * 60000)
  }

  const discard = () => {
    if (busy) return
    clearStaleSession(0)
  }

  return ReactDOM.createPortal(
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center animate-fade-in"
      style={{ background: 'rgba(0,0,0,0.78)', padding: 24 }}
    >
      <div
        style={{
          background: 'var(--c-surface)',
          border: '0.5px solid rgba(255,255,255,0.1)',
          borderRadius: 16,
          width: '100%', maxWidth: 460,
          boxShadow: '0 24px 80px rgba(0,0,0,0.6)',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '18px 24px',
          borderBottom: '0.5px solid rgba(255,255,255,0.07)',
        }}>
          <Clock size={17} style={{ color: 'var(--c-pink)', flexShrink: 0 }} />
          <div style={{ fontSize: 18, fontWeight: 700, color: 'rgba(255,255,255,0.9)' }}>
            Session left running
          </div>
        </div>

        {/* Body */}
        <div style={{ padding: '18px 24px 4px', fontSize: 16, color: 'rgba(255,255,255,0.55)', lineHeight: 1.65 }}>
          A session was still running when The Vault last closed. It started{' '}
          <span style={{ color: 'rgba(255,255,255,0.85)' }}>{fmtWhen(stale.startAt)}</span>{' '}
          and ran for about{' '}
          <span style={{ color: 'var(--c-pink)', fontWeight: 600 }}>{fmtDuration(stale.elapsedMs)}</span>{' '}
          before the app stopped responding.
        </div>

        {/* Editable duration */}
        <div style={{ padding: '16px 24px 20px' }}>
          <label
            htmlFor="recovered-minutes"
            style={{
              display: 'block', fontSize: 16, marginBottom: 8,
              color: 'rgba(255,255,255,0.4)',
            }}
          >
            Log it as
          </label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <input
              id="recovered-minutes"
              type="number"
              min="0"
              value={minutes}
              onChange={e => setMinutes(e.target.value)}
              style={{
                width: 110,
                padding: '9px 12px',
                borderRadius: 8,
                fontSize: 16,
                background: 'rgba(255,255,255,0.06)',
                color: 'rgba(255,255,255,0.9)',
                border: '0.5px solid rgba(255,255,255,0.12)',
                outline: 'none',
              }}
              onFocus={e => { e.target.style.borderColor = 'var(--c-accent)' }}
              onBlur={e => { e.target.style.borderColor = 'rgba(255,255,255,0.12)' }}
            />
            <span style={{ fontSize: 16, color: 'rgba(255,255,255,0.4)' }}>minutes</span>
          </div>
        </div>

        {/* Actions */}
        <div style={{
          display: 'flex', justifyContent: 'flex-end', gap: 10,
          padding: '14px 24px 18px',
          borderTop: '0.5px solid rgba(255,255,255,0.07)',
        }}>
          <button
            onClick={discard}
            disabled={busy}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '9px 16px', borderRadius: 9,
              fontSize: 16, cursor: busy ? 'default' : 'pointer',
              background: 'rgba(255,255,255,0.04)',
              color: 'rgba(255,255,255,0.5)',
              border: '0.5px solid rgba(255,255,255,0.1)',
              opacity: busy ? 0.5 : 1,
              transition: 'background 0.15s, color 0.15s',
            }}
            onMouseEnter={e => { if (!busy) e.currentTarget.style.color = 'rgba(255,255,255,0.8)' }}
            onMouseLeave={e => { e.currentTarget.style.color = 'rgba(255,255,255,0.5)' }}
          >
            <X size={14} /> Discard
          </button>
          <button
            onClick={keep}
            disabled={busy}
            style={{
              padding: '9px 18px', borderRadius: 9,
              fontSize: 16, fontWeight: 600,
              cursor: busy ? 'default' : 'pointer',
              background: 'color-mix(in srgb, var(--c-accent) 18%, transparent)',
              color: 'color-mix(in srgb, var(--c-accent) 80%, white)',
              border: '0.5px solid color-mix(in srgb, var(--c-accent) 40%, transparent)',
              opacity: busy ? 0.5 : 1,
              transition: 'background 0.15s',
            }}
            onMouseEnter={e => {
              if (!busy) e.currentTarget.style.background = 'color-mix(in srgb, var(--c-accent) 30%, transparent)'
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = 'color-mix(in srgb, var(--c-accent) 18%, transparent)'
            }}
          >
            {busy ? 'Saving…' : 'Log session'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}

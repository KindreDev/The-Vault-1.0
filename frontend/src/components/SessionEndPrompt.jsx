/**
 * "Did you finish?" — shown when Settings → Session is set to ask.
 *
 * Ending a session counts a climax against everything on screen, which is right
 * most of the time but not always. Rather than force one behaviour on everyone,
 * this asks. Backing out leaves the session running untouched.
 */
import React, { useEffect } from 'react'
import ReactDOM from 'react-dom'
import { Droplets } from 'lucide-react'
import { useVaultStore } from '../store/vault'
import { answerClimaxPrompt } from '../lib/session'

export default function SessionEndPrompt() {
  const open = useVaultStore(s => s.climaxPromptOpen)

  // Enter = yes, Escape = back out. The session is still running at this point,
  // so Escape must cancel rather than end it without a climax.
  useEffect(() => {
    if (!open) return
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); answerClimaxPrompt('cancel') }
      if (e.key === 'Enter')  { e.preventDefault(); answerClimaxPrompt('yes') }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  if (!open) return null

  const btn = (base) => ({
    padding: '9px 18px', borderRadius: 9, fontSize: 16, fontWeight: 600,
    cursor: 'pointer',
    background: `color-mix(in srgb, ${base} 18%, transparent)`,
    color: `color-mix(in srgb, ${base} 82%, white)`,
    border: `0.5px solid color-mix(in srgb, ${base} 40%, transparent)`,
    transition: 'background 0.15s',
  })

  return ReactDOM.createPortal(
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center animate-fade-in"
      style={{ background: 'rgba(0,0,0,0.78)', padding: 24 }}
      onClick={() => answerClimaxPrompt('cancel')}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--c-surface)',
          border: '0.5px solid rgba(255,255,255,0.1)',
          borderRadius: 16, width: '100%', maxWidth: 420,
          boxShadow: '0 24px 80px rgba(0,0,0,0.6)', overflow: 'hidden',
        }}
      >
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '18px 24px', borderBottom: '0.5px solid rgba(255,255,255,0.07)',
        }}>
          <Droplets size={17} style={{ color: 'var(--c-pink)', flexShrink: 0 }} />
          <div style={{ fontSize: 18, fontWeight: 700, color: 'rgba(255,255,255,0.9)' }}>
            Ending session
          </div>
        </div>

        <div style={{ padding: '18px 24px', fontSize: 16, color: 'rgba(255,255,255,0.55)', lineHeight: 1.65 }}>
          Did you finish? Counting it adds to the cum counter on everything
          currently on screen.
        </div>

        <div style={{
          display: 'flex', justifyContent: 'flex-end', gap: 10, flexWrap: 'wrap',
          padding: '12px 24px 18px', borderTop: '0.5px solid rgba(255,255,255,0.07)',
        }}>
          <button
            onClick={() => answerClimaxPrompt('cancel')}
            style={{
              padding: '9px 16px', borderRadius: 9, fontSize: 16, cursor: 'pointer',
              background: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.5)',
              border: '0.5px solid rgba(255,255,255,0.1)', marginRight: 'auto',
            }}
            onMouseEnter={e => { e.currentTarget.style.color = 'rgba(255,255,255,0.8)' }}
            onMouseLeave={e => { e.currentTarget.style.color = 'rgba(255,255,255,0.5)' }}
          >
            Keep going
          </button>
          <button
            onClick={() => answerClimaxPrompt('no')}
            style={btn('var(--c-accent)')}
            onMouseEnter={e => { e.currentTarget.style.background = 'color-mix(in srgb, var(--c-accent) 30%, transparent)' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'color-mix(in srgb, var(--c-accent) 18%, transparent)' }}
          >
            End, no climax
          </button>
          <button
            onClick={() => answerClimaxPrompt('yes')}
            style={btn('var(--c-pink)')}
            onMouseEnter={e => { e.currentTarget.style.background = 'color-mix(in srgb, var(--c-pink) 30%, transparent)' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'color-mix(in srgb, var(--c-pink) 18%, transparent)' }}
          >
            💦 Count it
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}

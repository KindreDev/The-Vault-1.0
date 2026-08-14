import React from 'react'
import { motion } from 'framer-motion'

// Labelled by the window rather than the cadence ("Today", not "Daily") because
// these boards reset — the label should say which slice of time you are looking
// at, not how often it refreshes.
export const HOF_PERIODS = [
  { id: 'day',   label: 'Today' },
  { id: 'week',  label: 'This week' },
  { id: 'month', label: 'This month' },
  { id: 'all',   label: 'All time' },
]

const STORAGE_KEY = 'vault.hofPeriod'

/** Last period the user looked at, so the page opens where they left it. */
export function loadHofPeriod() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    return HOF_PERIODS.some(p => p.id === saved) ? saved : 'all'
  } catch {
    return 'all'
  }
}

export function saveHofPeriod(period) {
  try { localStorage.setItem(STORAGE_KEY, period) } catch { /* private mode — not worth failing over */ }
}

export default function HofPeriodToggle({ value, onChange }) {
  return (
    <div className="inline-flex items-center gap-1 p-1 rounded-[14px]"
         style={{ background: 'rgba(255,255,255,0.04)',
                  border: '0.5px solid rgba(255,255,255,0.08)',
                  backdropFilter: 'blur(12px)' }}>
      {HOF_PERIODS.map(p => {
        const active = p.id === value
        return (
          <button key={p.id}
                  onClick={() => onChange(p.id)}
                  className="relative px-4 py-2 rounded-[10px] transition-colors"
                  style={{ fontSize: 16, fontWeight: active ? 700 : 500,
                           color: active ? 'var(--c-amber-text)' : 'rgba(255,255,255,0.45)' }}>
            {/* One shared layoutId across the four buttons is what makes the
                highlight slide between them instead of cross-fading. */}
            {active && (
              <motion.div layoutId="hof-period-pill"
                          transition={{ type: 'spring', stiffness: 400, damping: 32 }}
                          style={{ position: 'absolute', inset: 0, borderRadius: 10,
                                   background: 'color-mix(in srgb, var(--c-amber) 18%, transparent)',
                                   border: '0.5px solid color-mix(in srgb, var(--c-amber) 40%, transparent)',
                                   boxShadow: '0 0 20px 2px color-mix(in srgb, var(--c-amber) 12%, transparent)' }} />
            )}
            <span style={{ position: 'relative', zIndex: 1 }}>{p.label}</span>
          </button>
        )
      })}
    </div>
  )
}

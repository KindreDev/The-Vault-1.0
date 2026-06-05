import React from 'react'

export const BOND_TIERS = ['', 'Acquaintance', 'Friends', 'Crush', 'Waifu', 'Soulbound']

const HEART_COLORS = ['', '#C4A8A8', '#E07070', '#E84E8A', '#FF2D75', '#FF1A1A']

// Score thresholds matching the backend bond computation
const THRESHOLDS = [0, 100, 500, 1500, 3000, 6000]

const HEART_CSS = `
@keyframes bond-pulse {
  0%, 100% { transform: scale(1); }
  50%       { transform: scale(1.06); }
}
@keyframes bond-beat {
  0%, 100% { transform: scale(1); }
  14%      { transform: scale(1.22); }
  28%      { transform: scale(1); }
  42%      { transform: scale(1.12); }
  56%      { transform: scale(1); }
}
`

function heartStyle(index, level) {
  if (index >= level) return { color: 'rgba(255,255,255,0.13)' }
  const color = HEART_COLORS[level]
  const anim =
    level === 2 ? 'bond-pulse 3s ease-in-out infinite'
  : level === 3 ? 'bond-pulse 2s ease-in-out infinite'
  : level === 4 ? 'bond-beat 1.3s ease-in-out infinite'
  : level === 5 ? 'bond-beat 0.85s ease-in-out infinite'
  : 'none'
  return {
    color,
    animation: anim,
    filter: level >= 4 ? `drop-shadow(0 0 4px ${color}bb)` : 'none',
  }
}

/**
 * BondHearts — read-only display of bond level.
 *
 * Props:
 *   level        — 0–5 bond level
 *   excluded     — if true, renders nothing (male/unknown artists)
 *   size         — 'sm' (cards) | 'lg' (profile)
 *   bondScore    — numeric score (used for progress bar, optional)
 *   showProgress — show progress bar toward next tier (only at size=lg)
 */
export default function BondHearts({
  level = 0,
  excluded = false,
  size = 'sm',
  bondScore = 0,
  showProgress = false,
}) {
  if (excluded) return null

  const isLg    = size === 'lg'
  const heartPx = isLg ? 26 : 14

  // Progress bar computation
  let progressPct  = 0
  let progressText = null
  if (showProgress && isLg) {
    if (level >= 5) {
      progressPct  = 100
      progressText = 'Max bond'
    } else {
      const lo   = THRESHOLDS[level]
      const hi   = THRESHOLDS[level + 1]
      progressPct = Math.min(100, Math.max(0, ((bondScore - lo) / (hi - lo)) * 100))
      const rem  = Math.ceil(hi - bondScore)
      progressText = level === 0
        ? `${Math.ceil(bondScore)} / ${hi} pts to unlock`
        : `${rem > 0 ? rem : 0} pts to ${BOND_TIERS[level + 1]}`
    }
  }

  const color = level > 0 ? HEART_COLORS[level] : 'rgba(255,255,255,0.3)'

  return (
    <>
      <style>{HEART_CSS}</style>
      <div className="flex flex-col" style={{ gap: isLg ? 6 : 0 }}>
        {/* Hearts row */}
        <div
          className={`flex items-center ${isLg ? 'gap-2.5' : 'gap-1'}`}
          title={level > 0 ? BOND_TIERS[level] : 'No bond yet'}
        >
          {Array.from({ length: 5 }, (_, i) => (
            <span
              key={i}
              style={{
                ...heartStyle(i, level),
                fontSize: heartPx,
                lineHeight: 1,
                display: 'inline-block',
              }}
            >
              ♥
            </span>
          ))}
          {isLg && level > 0 && (
            <span className="ml-1.5 font-semibold" style={{ color, fontSize: 17 }}>
              {BOND_TIERS[level]}
            </span>
          )}
        </div>

        {/* Progress bar */}
        {showProgress && isLg && (
          <div className="flex flex-col gap-1" style={{ maxWidth: 220 }}>
            <div style={{ height: 4, borderRadius: 99, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
              <div
                style={{
                  height: '100%',
                  width: `${progressPct}%`,
                  borderRadius: 99,
                  background: level >= 5 ? `linear-gradient(90deg, ${color}, #FF6060)` : color,
                  transition: 'width 0.6s ease',
                  boxShadow: level >= 4 ? `0 0 6px ${color}88` : 'none',
                }}
              />
            </div>
            {progressText && (
              <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.3)' }}>
                {progressText}
              </span>
            )}
          </div>
        )}
      </div>
    </>
  )
}

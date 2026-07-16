import React from 'react'
import { BadgeCheck } from 'lucide-react'

/**
 * Tiered verified badge. tier: 'none' | 'blue' | 'gold'.
 * blue  = a creator you engage with; gold = a beloved, heavily-bonded girl.
 * Renders nothing for 'none' (unknown / no interaction).
 */
export default function VerifiedBadge({ tier, size = 18 }) {
  if (!tier || tier === 'none') return null
  const color = tier === 'gold' ? '#EFB33C' : '#4A9EF8'
  const glow = tier === 'gold' ? 'rgba(239,179,60,0.55)' : 'rgba(74,158,248,0.5)'
  return (
    <span
      title={tier === 'gold' ? 'Verified · beloved' : 'Verified'}
      style={{ display: 'inline-flex', filter: `drop-shadow(0 0 4px ${glow})`, flexShrink: 0 }}
    >
      <BadgeCheck size={size} style={{ color }} fill="none" strokeWidth={2.4} />
    </span>
  )
}

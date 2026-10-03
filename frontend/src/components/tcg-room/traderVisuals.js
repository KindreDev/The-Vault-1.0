/**
 * Presentation-only trader configuration. Keep visit state, stock and trade
 * rules in the backend; this registry only supplies artwork and color tokens.
 * Add one entry per stable trader id as new visitors are introduced.
 */
export const TRADER_VISUALS = Object.freeze({
  yoruichi: Object.freeze({
    palette: Object.freeze({
      accent: '#ef4d69',
      accentSoft: '#ff8b9b',
      glow: 'rgba(207, 35, 62, .28)',
      surface: '#160f14',
      surfaceRaised: '#211319',
      text: '#fff3f1',
    }),
    outfits: Object.freeze([
      { id: 'alternate', label: 'Alternate', src: '/traders/red-trader-alt.png' },
      { id: 'outfit-3', label: 'Outfit 3', src: '/traders/yoru-outfit-3.png' },
    ]),
  }),
  rika: Object.freeze({
    palette: Object.freeze({
      accent: '#70c8ed',
      accentSoft: '#a1e2ff',
      glow: 'rgba(86, 183, 231, .28)',
      surface: '#10151d',
      surfaceRaised: '#182330',
      text: '#f2f8ff',
    }),
    outfits: Object.freeze([
      { id: 'bunny', label: 'Bunny', src: '/traders/rika.png' },
    ]),
  }),
  lisa: Object.freeze({
    palette: Object.freeze({
      accent: '#55d0c6',
      accentSoft: '#8ce8df',
      glow: 'rgba(70, 204, 191, .26)',
      surface: '#101719',
      surfaceRaised: '#1a2527',
      text: '#f0fffd',
    }),
    outfits: Object.freeze([
      { id: 'classic', label: 'Classic', src: '/traders/lisa.png' },
    ]),
  }),
})

export function traderVisualKey(trader) {
  const id = String(trader?.id ?? '').trim()
  return TRADER_VISUALS[id] ? id : ''
}

/** Stable across reloads for a trader and the user's local calendar day. */
export function selectDailyTraderOutfit(traderKey, outfits, date = new Date()) {
  if (!outfits?.length) return null
  const day = `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`
  const seed = `${traderKey || 'visitor'}:${day}`
  let hash = 2166136261
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  // 32-bit avalanche keeps adjacent calendar days from looking like a toggle.
  hash ^= hash >>> 16
  hash = Math.imul(hash, 0x85ebca6b)
  hash ^= hash >>> 13
  hash = Math.imul(hash, 0xc2b2ae35)
  hash ^= hash >>> 16
  return outfits[(hash >>> 0) % outfits.length]
}

export function localCalendarDay(date = new Date()) {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`
}

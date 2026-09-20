// Explicit Collection Room budgets.  These remain user-selectable so weaker
// hardware can opt into a predictable render and texture cost.
export const ROOM_QUALITY_PROFILES = Object.freeze({
  high: Object.freeze({ key: 'high', cardWidth: 1024, cardHeight: 1536, cardAnisotropy: 16, worldAnisotropy: 8, dpr: 1, shadows: true, foilDistance: 1, foilMasks: 'full' }),
  medium: Object.freeze({ key: 'medium', cardWidth: 512, cardHeight: 768, cardAnisotropy: 4, worldAnisotropy: 4, dpr: 1, shadows: false, foilDistance: 1, foilMasks: 'near' }),
  low: Object.freeze({ key: 'low', cardWidth: 384, cardHeight: 576, cardAnisotropy: 2, worldAnisotropy: 2, dpr: .75, shadows: false, foilDistance: .45, foilMasks: 'inspection' }),
})

export function roomQualityProfile(value) {
  return ROOM_QUALITY_PROFILES[value] || ROOM_QUALITY_PROFILES.medium
}

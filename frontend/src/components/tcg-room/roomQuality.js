// Explicit Collection Room budgets.  These remain user-selectable so weaker
// hardware can opt into a predictable render and texture cost.
//
// Shadows are rendered as a static map (refreshed only when the room changes),
// so they are cheap enough for Medium.  foilDistance is the real camera
// distance in metres at which a displayed card switches to its live foil.
export const ROOM_QUALITY_PROFILES = Object.freeze({
  high: Object.freeze({ key: 'high', cardWidth: 1024, cardHeight: 1536, cardAnisotropy: 16, worldAnisotropy: 8, dpr: [1, 1.5], antialias: true, shadows: true, shadowMapSize: 2048, foilDistance: 2.6, foilMasks: 'full' }),
  medium: Object.freeze({ key: 'medium', cardWidth: 512, cardHeight: 768, cardAnisotropy: 4, worldAnisotropy: 4, dpr: 1, antialias: false, shadows: true, shadowMapSize: 1024, foilDistance: 1.8, foilMasks: 'near' }),
  low: Object.freeze({ key: 'low', cardWidth: 384, cardHeight: 576, cardAnisotropy: 2, worldAnisotropy: 2, dpr: .75, antialias: false, shadows: false, shadowMapSize: 512, foilDistance: .45, foilMasks: 'inspection' }),
})

export function roomQualityProfile(value) {
  return ROOM_QUALITY_PROFILES[value] || ROOM_QUALITY_PROFILES.medium
}

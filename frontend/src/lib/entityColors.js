// One source for the colors that identify creator types and card rarities.
// Pages used to keep their own copies, which drift apart over time.

export const CREATOR_TYPE_TEXT = {
  cosplayer: '#9FE1CB',
  ethot:     '#ED93B1',
  artist:    '#CECBF6',
  character: '#FAC775',
  actress:   '#ED93B1',
  custom:    '#D3D1C7',
}

const CREATOR_TYPE_TINT = {
  cosplayer: 'var(--c-green)',
  ethot:     'var(--c-pink)',
  artist:    'var(--c-accent)',
  character: 'var(--c-amber)',
  actress:   'var(--c-pink)',
}

const tint = (type, percent) => CREATOR_TYPE_TINT[type]
  ? `color-mix(in srgb, ${CREATOR_TYPE_TINT[type]} ${percent}%, transparent)`
  : `rgba(136,135,128,${percent / 100})`

// { type: { bg, text, glow? } } — bgPercent sets how strong the tinted
// background is (badges use 15, highlighted cards 20–25).
export function creatorTypeColors(bgPercent = 15, glowPercent = null) {
  return Object.fromEntries(Object.keys(CREATOR_TYPE_TEXT).map(type => [type, {
    bg: tint(type, bgPercent),
    text: CREATOR_TYPE_TEXT[type],
    ...(glowPercent != null ? { glow: tint(type, glowPercent) } : {}),
  }]))
}

export const RARITY_COLORS = {
  common:    '#888780',
  uncommon:  '#1D9E75',
  rare:      '#378ADD',
  epic:      '#7F77DD',
  legendary: '#BA7517',
  celestial: '#E0B0FF',
}

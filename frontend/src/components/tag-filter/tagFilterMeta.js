// Shared look-up data for the tag filter.

// Category order and labels for the browse pills. Unknown categories are
// appended after these, using their raw name.
export const CATEGORIES = [
  { key: 'body_part', label: 'Body', color: '#E07B54' },
  { key: 'clothing', label: 'Clothing', color: '#1D9E75' },
  { key: 'pose', label: 'Pose', color: '#8B93A7' },
  { key: 'nudity_level', label: 'Nudity', color: '#BA7517' },
  { key: 'sex_act', label: 'Sex acts', color: '#D4537E' },
  { key: 'position', label: 'Positions', color: '#9B59B6' },
  { key: 'physical_feature', label: 'Features', color: '#378ADD' },
  { key: 'character', label: 'Characters', color: '#7F77DD' },
  { key: 'style', label: 'Style', color: '#4B9E6E' },
  { key: 'subject', label: 'People', color: '#9CA3AF' },
  { key: 'general', label: 'Other', color: '#777777' },
]
export const CATEGORY_BY_KEY = Object.fromEntries(CATEGORIES.map(c => [c.key, c]))
export const categoryColor = key => CATEGORY_BY_KEY[key]?.color || '#777777'

// Ratings, lowest to highest. Semantic colours, independent of the theme.
export const RATINGS = [
  { name: 'safe', label: 'Safe', color: 'var(--c-green)' },
  { name: 'suggestive', label: 'Suggestive', color: 'var(--c-amber)' },
  { name: 'explicit', label: 'Explicit', color: 'var(--c-pink)' },
  { name: 'hardcore', label: 'Hardcore', color: '#E5484D' },
]

export const tokenFor = tag => `id:${tag.id}`

// Include = theme accent, exclude = theme pink, so both follow the palette.
export const INCLUDE = {
  text: 'var(--c-accent-text)',
  bg: 'color-mix(in srgb, var(--c-accent) 20%, transparent)',
  line: 'color-mix(in srgb, var(--c-accent) 45%, transparent)',
  solid: 'var(--c-accent)',
}
export const EXCLUDE = {
  text: 'var(--c-pink-text)',
  bg: 'color-mix(in srgb, var(--c-pink) 18%, transparent)',
  line: 'color-mix(in srgb, var(--c-pink) 45%, transparent)',
  solid: 'var(--c-pink)',
}

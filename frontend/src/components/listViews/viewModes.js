import { useCallback, useState } from 'react'

// View modes offered by the Photos, Videos and Galleries lists. Each list
// picks the subset that fits it; the dropdown shows them in this order.
export const VIEW_MODES = {
  grid:      { label: 'Squares',        hint: 'Even square tiles' },
  cards:     { label: 'Gallery cards',  hint: 'Cover with details' },
  compact:   { label: 'Compact covers', hint: 'Cover and title only' },
  portrait:  { label: 'Portrait cards', hint: 'Large photo cards' },
  avatars:   { label: 'Compact',        hint: 'Small avatar and name' },
  masonry:   { label: 'Masonry',        hint: 'Columns, original shapes' },
  justified: { label: 'Justified rows', hint: 'Full-width rows, no cropping' },
  details:   { label: 'Details',        hint: 'Sortable table' },
  timeline:  { label: 'Timeline',       hint: 'Grouped by month' },
}

export const MEDIA_VIEW_MODES = ['grid', 'masonry', 'justified', 'details', 'timeline']
export const GALLERY_VIEW_MODES = ['cards', 'compact', 'details', 'timeline']
export const CREATOR_VIEW_MODES = ['portrait', 'avatars', 'details']

function readStored(key, allowed, fallback, legacy) {
  try {
    const stored = localStorage.getItem(key)
    if (allowed.includes(stored)) return stored
    const migrated = legacy?.()
    if (allowed.includes(migrated)) return migrated
  } catch {}
  return fallback
}

// Remembers the chosen view per list. Storage can be unavailable (private
// window, blocked site data); the list then simply opens in its default view.
export function useListViewMode(key, allowed, fallback, legacy) {
  const [mode, setModeState] = useState(() => readStored(key, allowed, fallback, legacy))
  const setMode = useCallback((next) => {
    setModeState(next)
    try { localStorage.setItem(key, next) } catch {}
  }, [key])
  return [allowed.includes(mode) ? mode : fallback, setMode]
}

// Timeline groups by Period, Date modified or Date added (timelineDate).
// Opening Timeline keeps Period or Date modified and otherwise switches to
// Period: it is set on nearly every gallery and says when the content is
// from, while Date added (the default sort) only spans the time since
// import. Date added can still be picked afterwards.
export const TIMELINE_START_SORTS = ['period', 'date_modified']

// The date a Timeline section uses for an item under the active sort.
// Returns { date, yearOnly } (a gallery period may have no month) or null.
export function timelineDate(item, sortBy, modifiedField) {
  if (sortBy === 'period') {
    if (!item.period_year) return null
    return { date: new Date(item.period_year, (item.period_month || 1) - 1), yearOnly: !item.period_month }
  }
  const date = parseDate(sortBy === 'date_modified' ? item[modifiedField] : item.created_at)
  return date ? { date, yearOnly: false } : null
}

// Month buckets for the Timeline view. Items stay in the order the list
// sorted them; a new section starts whenever the month changes.
export function groupByMonth(items, getDate, locale) {
  const lang = locale === 'zh-CN' ? 'zh-CN' : 'en-US'
  const monthFmt = new Intl.DateTimeFormat(lang, { month: 'long', year: 'numeric' })
  const yearFmt = new Intl.DateTimeFormat(lang, { year: 'numeric' })
  const groups = []
  items.forEach((item, index) => {
    const found = getDate(item)
    const date = found?.date
    const valid = date instanceof Date && !Number.isNaN(date.getTime())
    const key = !valid ? 'undated' : found.yearOnly ? `${date.getFullYear()}` : `${date.getFullYear()}-${date.getMonth()}`
    let group = groups[groups.length - 1]
    if (!group || group.key !== key) {
      group = { key, label: valid ? (found.yearOnly ? yearFmt : monthFmt).format(date) : null, entries: [] }
      groups.push(group)
    }
    group.entries.push({ item, index })
  })
  return groups
}

export function parseDate(value) {
  if (!value) return null
  // Backend datetimes are naive UTC; treat them as UTC.
  const text = typeof value === 'string' && !/[zZ]|[+-]\d\d:?\d\d$/.test(value) ? `${value}Z` : value
  const date = new Date(text)
  return Number.isNaN(date.getTime()) ? null : date
}

export function formatShortDate(value, locale) {
  const date = parseDate(value)
  if (!date) return '—'
  return date.toLocaleDateString(locale === 'zh-CN' ? 'zh-CN' : 'en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function formatBytes(bytes) {
  const n = Number(bytes)
  if (!Number.isFinite(n) || n <= 0) return '—'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)))
  return `${(n / 1024 ** i).toFixed(i >= 2 ? 1 : 0)} ${units[i]}`
}

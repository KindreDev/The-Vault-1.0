export const TRADER_TABS = Object.freeze([
  ['cards', 'Her Cards'],
  ['trade', 'Trade'],
  ['grading', 'Grading'],
  ['requests', 'Requests'],
  ['history', 'Deal History'],
])

const ERROR_FIELD_LABELS = Object.freeze({
  card_id: 'Card catalog code',
  card_code: 'Card catalog code',
  copy_ids: 'Selected cards',
  visit_id: 'Trader visit',
})

function readableErrorValue(value) {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return value.map(readableErrorValue).filter(Boolean).join(' · ')
  if (!value || typeof value !== 'object') return ''
  if (value.detail !== undefined) return readableErrorValue(value.detail)
  if (Array.isArray(value.errors)) return readableErrorValue(value.errors)
  const message = value.msg || value.message || value.error_description || value.title
  if (message) {
    const location = Array.isArray(value.loc) ? value.loc.filter(part => !['body', 'query', 'path'].includes(String(part).toLowerCase())) : []
    const field = location.map(part => ERROR_FIELD_LABELS[String(part)] || String(part).replaceAll('_', ' ')).join(' · ')
    return field ? `${field}: ${readableErrorValue(message)}` : readableErrorValue(message)
  }
  try { return JSON.stringify(value) } catch { return '' }
}

export function readableTraderError(error) {
  const responseData = error?.response?.data
  const detail = responseData?.detail ?? responseData ?? error?.message
  return readableErrorValue(detail) || 'Something went wrong. Please try again.'
}

export function cardLabel(cardId, details = {}) {
  return details.display_title || details.display_name || details.catalog_code || `Card #${cardId}`
}

export function offerSummary(offer) {
  const credits = Number(offer?.credits_delta || 0)
  const shards = Number(offer?.shards_delta || 0)
  const pieces = []
  if (credits) pieces.push(`${credits > 0 ? '+' : ''}${credits.toLocaleString()} Credits`)
  if (shards) pieces.push(`${shards > 0 ? '+' : ''}${shards.toLocaleString()} Shards`)
  return pieces.join(' / ') || 'Card exchange'
}

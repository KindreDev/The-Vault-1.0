export const TRADER_TABS = Object.freeze([
  ['dialogue', 'Dialogue'],
  ['cards', 'Her Cards'],
  ['sell', 'Sell'],
  ['trade', 'Trade'],
  ['requests', 'Requests'],
  ['history', 'Deal History'],
])

export function traderGate(visit) {
  if (!visit) return { locked: true, title: 'Checking this week\'s visit', detail: 'The saved visitor and approval state are loading.' }
  if (!visit.production_enabled) return {
    locked: true,
    title: 'Trading is safely locked',
    detail: 'Her stock and transactions stay disabled until the required economy simulation is reviewed and approved. This visit and conversation still persist.',
  }
  return { locked: false, title: '', detail: '' }
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

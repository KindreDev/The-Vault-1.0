import { tcgTradersApi } from '../../lib/api'

// Card previews ask for their card one at a time; this gathers every request
// made in the same tick into a single batch call (max 120 ids per call).
const BATCH_LIMIT = 120
let pending = new Map()
let scheduled = false

async function flush() {
  scheduled = false
  const batch = pending
  pending = new Map()
  const ids = [...batch.keys()]
  for (let start = 0; start < ids.length; start += BATCH_LIMIT) {
    const chunk = ids.slice(start, start + BATCH_LIMIT)
    try {
      const response = await tcgTradersApi.cards(chunk)
      const byId = new Map((Array.isArray(response.data) ? response.data : []).map(card => [Number(card.id), card]))
      for (const id of chunk) {
        const card = byId.get(id)
        for (const waiter of batch.get(id)) card ? waiter.resolve(card) : waiter.reject(new Error(`Card #${id} not found`))
      }
    } catch (error) {
      for (const id of chunk) for (const waiter of batch.get(id)) waiter.reject(error)
    }
  }
}

export function loadTraderCard(cardId) {
  const id = Number(cardId)
  return new Promise((resolve, reject) => {
    if (!pending.has(id)) pending.set(id, [])
    pending.get(id).push({ resolve, reject })
    if (!scheduled) {
      scheduled = true
      setTimeout(flush, 0)
    }
  })
}

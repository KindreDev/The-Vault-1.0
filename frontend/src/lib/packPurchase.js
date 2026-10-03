const STORAGE_KEY = 'vault.pending-pack-purchase.v1'
let active = null

export function pendingPackPurchase() {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (!raw) return null
  const value = JSON.parse(raw)
  if (!value?.productId || !value?.data?.request_id) throw new Error('Saved booster purchase could not be read.')
  return value
}

// Save before sending and retain the identifier through timeouts and reloads.
// A confirmed validation failure rolls back the server transaction.
export function openRecoverablePack(send, productId, data = {}) {
  if (active) return Promise.reject(new Error('A booster purchase is already in progress.'))
  active = (async () => {
    let pending = pendingPackPurchase()
    if (pending && (Number(pending.productId) !== Number(productId)
      || (pending.data.selected_release_id || null) !== (data.selected_release_id || null)
      || (pending.data.target_card_type || null) !== (data.target_card_type || null))) {
      throw new Error('Resume the unfinished booster purchase in the Shop before buying another.')
    }
    if (!pending) {
      pending = { productId, data: { ...data, request_id: crypto.randomUUID() } }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(pending))
    }
    try {
      const response = await send(pending.productId, pending.data)
      localStorage.removeItem(STORAGE_KEY)
      return response
    } catch (error) {
      if ([400, 422].includes(error.response?.status)) localStorage.removeItem(STORAGE_KEY)
      throw error
    }
  })().finally(() => { active = null })
  return active
}

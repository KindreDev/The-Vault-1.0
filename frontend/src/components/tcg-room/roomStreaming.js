// Static room assets stay resident for the complete visit. GPU-side clipping is
// allowed, but React never removes furniture because of distance or direction.
export function selectStreamedItems({ items }) {
  return items.map(item => ({ ...item, lowLod: Boolean(item.lowLod) }))
}

export const STREAM_LIMITS = Object.freeze({ low: Infinity, medium: Infinity, high: Infinity })

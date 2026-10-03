export const BINDER_PRODUCTS = [
  { id: 'obsidian', name: 'Obsidian Leather Binder', image: '/binder-obsidian-leather.png', description: 'Black leather, stitched edges, and a dedicated home for your favorite cards.' },
  { id: 'canvas-violet', name: 'Violet Canvas Binder', image: '/binder-canvas-violet.png', description: 'Rich violet canvas with a soft woven finish for your collection.' },
  { id: 'opaline', name: 'Opaline Vinyl Binder', image: '/binder-opaline.png', description: 'Pearlescent vinyl with a luminous finish for your treasured cards.' },
  { id: 'rose-metal', name: 'Rose Metal Binder', image: '/binder-rose-metal.png', description: 'A rose-toned metallic finish for a standout collection.' },
].map(item => ({ ...item, key: `binder-${item.id}`, kind: 'binders', price: 1200 }))
export const PACK_WRAPPERS = {
  permanent: '/tcg-booster-permanent-cutout.png', release_standard: '/tcg-booster-standard-cutout.png',
  release_premium: '/tcg-booster-premium-cutout.png', limited: '/tcg-booster-limited-cutout.png',
  weekly_protection: '/tcg-booster-limited-cutout.png',
}
// Tokens belong to a product, even when cart lines select different releases.
export function priceCart(lines, binderCount) {
  let freeBinder = binderCount === 0
  const remaining = new Map()
  return lines.map(line => {
    const product = line.product
    let free = 0
    if (product.kind === 'binders') {
      if (freeBinder) { free = 1; freeBinder = false }
    } else {
      const tokens = remaining.has(product.id) ? remaining.get(product.id) : Number(product.tokens || 0)
      free = Math.min(tokens, line.quantity)
      remaining.set(product.id, tokens - free)
    }
    return { ...line, free, total: (line.quantity - free) * Number(product.price || 0) }
  })
}

import { PACK_WRAPPERS } from './shopCatalog.js'

// Report each completed item immediately so a later failure cannot repurchase it.
export async function checkoutCart(lines, api, onCompleted, onProgress, opened) {
  let completed = 0
  const count = lines.reduce((sum, line) => sum + line.quantity, 0)
  for (const line of lines) {
    for (let index = 0; index < line.quantity; index++) {
      onProgress(line.product.name, completed + 1, count)
      if (line.product.kind === 'binders') {
        await api.createBinder({ name: line.product.name, cover_style: line.product.id, page_style: 'nine-pocket' })
      } else {
        const { data } = await api.openPack(line.product.id, { selected_release_id: line.releaseId, target_card_type: line.targetCardType || undefined, use_token: index < line.free })
        const product = { ...line.product, ...data.product, wrapper_src: line.product.wrapper_src || PACK_WRAPPERS[line.product.product_kind], collage_images: line.product.preview_art_urls_by_release?.[String(line.releaseId)] || line.product.preview_art_urls || [] }
        const cards = data.cards || []
        const size = data.product?.card_count || cards.length || 1
        for (let offset = 0; offset < cards.length; offset += size) opened.push({ product, cards: cards.slice(offset, offset + size) })
      }
      completed++
      onCompleted(line.key)
    }
  }
}

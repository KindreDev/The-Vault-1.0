export function boosterArtCandidates(product = {}) {
  const direct = [
    ...(Array.isArray(product.collage_images) ? product.collage_images : []),
    ...(Array.isArray(product.collageImages) ? product.collageImages : []),
    ...(Array.isArray(product.preview_art_urls) ? product.preview_art_urls : []),
  ]
  const byRelease = direct.length ? [] : Object.values(product.preview_art_urls_by_release || {}).flatMap(value => Array.isArray(value) ? value : [])
  return [...new Set([...direct, ...byRelease].filter(Boolean))]
}

export function sampleBoosterArt(candidates, count = 5, excluded = []) {
  const blocked = new Set(excluded.filter(Boolean))
  const pool = [...new Set((candidates || []).filter(url => url && !blocked.has(url)))]
  for (let index = pool.length - 1; index > 0; index--) {
    const swap = Math.floor(Math.random() * (index + 1))
    ;[pool[index], pool[swap]] = [pool[swap], pool[index]]
  }
  return pool.slice(0, count)
}

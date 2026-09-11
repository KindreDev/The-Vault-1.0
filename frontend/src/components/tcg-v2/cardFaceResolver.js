const TYPE_ALIASES = Object.freeze({
  image: 'scene',
  scene: 'scene',
  character: 'character',
  variant: 'cosplay',
  cosplay: 'cosplay',
  collab: 'collab',
  creator: 'creator',
  gallery: 'gallery',
  bond: 'bond',
  hof: 'hall-of-fame',
  'hall-of-fame': 'hall-of-fame',
})

const VISUAL_KEYS = Object.freeze({
  scene: 'scene_visual',
  character: 'character_visual',
  cosplay: 'cosplay_visual',
  collab: 'collab_visual',
  creator: 'creator_visual',
  gallery: 'gallery_visual',
  bond: 'bond_visual',
  'hall-of-fame': 'hof_visual',
})

export function normalizeTCGV2CardType(type) {
  return TYPE_ALIASES[String(type || '').toLowerCase()] || null
}

export function resolveTCGV2CardFace(card) {
  if (!card || typeof card !== 'object') return null

  // A frozen visual contract is more authoritative than the legacy card_type.
  // Character cards in particular may originate from legacy records whose
  // storage type does not describe the approved V2 face.
  const prepared = Object.entries(VISUAL_KEYS)
    .map(([type, key]) => ({ type, visual: card[key] }))
    .find(({ visual }) => visual?.recipe)

  const type = prepared?.type || normalizeTCGV2CardType(card.card_type)
  if (!type) return null

  const visual = prepared?.visual || card[VISUAL_KEYS[type]]
  if (!visual?.recipe) return null

  const artUrl = visual.art_url || card.image_url || card.art_url || null
  if (!artUrl) return null

  const signatureUrl = visual.signature_url || card.signature_url || null
  const signatureUrls = Array.isArray(visual.signature_urls)
    ? visual.signature_urls.filter(Boolean)
    : (signatureUrl ? [signatureUrl] : [])

  const liveRarity = ['C', 'R', 'SR', 'SPR', 'UR'].includes(card.rarity_class)
    ? card.rarity_class
    : visual.recipe.rarity
  const recipe = liveRarity && liveRarity !== visual.recipe.rarity
    ? { ...visual.recipe, rarity: liveRarity }
    : visual.recipe

  return {
    type,
    recipe,
    artUrl,
    stackArtUrls: visual.stack_art_urls || [],
    packedMaskUrl: visual.mask_url || card.mask_url || null,
    signatureUrl,
    signatureUrls,
    readiness: visual.readiness || null,
    visualMode: visual.visual_mode || card.mask_visual_mode || null,
  }
}

export const TCG_V2_CARD_TYPES = Object.freeze(Object.keys(VISUAL_KEYS))

export const BOND_RARITIES = Object.freeze(['C', 'R', 'SR', 'UR', 'SPR'])
const required = (v, field) => { const x = String(v ?? '').trim(); if (!x) throw new Error(`Bond recipe requires real ${field}`); return x }
const id = (v, field) => { const x = Number(v); if (!Number.isInteger(x) || x <= 0) throw new Error(`Bond recipe requires a real ${field}`); return x }
const freeze = value => { if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value; Object.values(value).forEach(freeze); return Object.freeze(value) }

export function createBondRecipe(input) {
  const rarity = required(input.rarity, 'rarity').toUpperCase()
  if (!BOND_RARITIES.includes(rarity)) throw new Error(`Unsupported Bond rarity: ${rarity}`)
  const snapshot = input.snapshot || {}, source = input.source || {}, earned = input.earnedState || {}
  const current = Number(earned.currentMilestone)
  if (![5, 15, 25].includes(current)) throw new Error('Bond recipe requires a real milestone')
  if (rarity === 'SPR' && !String(snapshot.creatorName || '').trim()) {
    throw new Error('SPR Bond recipes require a creator name for their signature')
  }
  return freeze({
    schema: 'vault.bond-card-recipe', version: 1, cardType: 'bond', rarity,
    templateId: 'bond-pearlescent-hearts-v1',
    snapshot: {
      imageId: id(snapshot.imageId, 'image ID'), galleryId: id(snapshot.galleryId, 'gallery ID'),
      galleryName: required(snapshot.galleryName, 'gallery name'),
      creatorId: snapshot.creatorId == null ? null : id(snapshot.creatorId, 'creator ID'),
      creatorName: String(snapshot.creatorName || '').trim() || null,
      creatorTypeLabel: String(snapshot.creatorTypeLabel || '').trim() || null,
      periodLabel: String(snapshot.periodLabel || '').trim() || null,
      cardId: required(snapshot.cardId, 'card ID'), mintedAt: required(snapshot.mintedAt, 'mint timestamp'),
    },
    source: {
      kind: 'image', imageId: id(source.imageId, 'source image ID'),
      width: Number(source.width), height: Number(source.height),
      focalX: Math.min(1, Math.max(0, Number(source.focalX ?? .5))),
      focalY: Math.min(1, Math.max(0, Number(source.focalY ?? .2))),
    },
    palette: input.palette || {},
    earnedState: { cumCount: Number(earned.cumCount), currentMilestone: current, milestones: earned.milestones || [] },
    effectHooks: input.effectHooks || ['art', 'background-foil', 'subject-foil', 'edge-foil', 'frame', 'hearts', 'sparkles', 'rarity', 'milestone', 'text', 'signature'],
  })
}

export function bondCoverGeometry(recipe) {
  const sourceWidth = Number(recipe.source.width)
  const sourceHeight = Number(recipe.source.height)
  if (!(sourceWidth > 0) || !(sourceHeight > 0)) throw new Error('Bond source dimensions must be positive')
  const cardWidth = 1024, cardHeight = 1536
  const sourceRatio = sourceWidth / sourceHeight
  const cardRatio = cardWidth / cardHeight
  if (sourceRatio >= cardRatio) {
    const height = cardHeight
    const width = height * sourceRatio
    return { x: -(width - cardWidth) * recipe.source.focalX, y: 0, width, height }
  }
  const width = cardWidth
  const height = width / sourceRatio
  return { x: 0, y: -(height - cardHeight) * recipe.source.focalY, width, height }
}

export const CREATOR_RARITIES = Object.freeze(['C', 'R', 'SR', 'UR', 'SPR'])

function required(value, field) {
  const result = String(value ?? '').trim()
  if (!result) throw new Error(`Creator recipe requires real ${field} data`)
  return result
}

function positiveId(value, field) {
  const result = Number(value)
  if (!Number.isInteger(result) || result <= 0) throw new Error(`Creator recipe requires a real ${field}`)
  return result
}

function color(value, field) {
  const result = required(value, field).toUpperCase()
  if (!/^#[0-9A-F]{6}$/.test(result)) throw new Error(`Invalid Creator ${field}`)
  return result
}

function freezeDeep(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  Object.values(value).forEach(freezeDeep)
  return Object.freeze(value)
}

export function createCreatorRecipe(input) {
  const rarity = required(input.rarity, 'rarity').toUpperCase()
  if (!CREATOR_RARITIES.includes(rarity)) throw new Error(`Unsupported Creator rarity: ${rarity}`)
  const snapshot = input.snapshot || {}
  const source = input.source || {}
  const palette = input.palette || {}
  const sourceKind = required(source.kind, 'source kind')
  if (!['image', 'avatar'].includes(sourceKind)) throw new Error(`Unsupported Creator source kind: ${sourceKind}`)
  const recipe = {
    schema: 'vault.creator-card-recipe', version: 2, cardType: 'creator',
    rarity, templateId: 'creator-archive-rail-v1',
    snapshot: {
      creatorId: positiveId(snapshot.creatorId, 'creator ID'),
      creatorName: required(snapshot.creatorName, 'creator name'),
      creatorType: required(snapshot.creatorType, 'creator type'),
      creatorTypeLabel: required(snapshot.creatorTypeLabel, 'creator type label'),
      originLabel: String(snapshot.originLabel || '').trim() || null,
      cardId: required(snapshot.cardId, 'card ID'),
      mintedAt: required(snapshot.mintedAt, 'mint timestamp'),
    },
    source: {
      kind: sourceKind,
      imageId: sourceKind === 'image' ? positiveId(source.imageId, 'source image ID') : null,
      creatorId: sourceKind === 'avatar' ? positiveId(source.creatorId, 'avatar creator ID') : null,
      width: Number(source.width), height: Number(source.height),
      focalX: Math.min(1, Math.max(0, Number(source.focalX ?? 0.5))),
      focalY: Math.min(1, Math.max(0, Number(source.focalY ?? 0.2))),
    },
    palette: {
      background: color(palette.background, 'background color'),
      primary: color(palette.primary, 'primary color'),
      secondary: color(palette.secondary, 'secondary color'),
      ink: color(palette.ink, 'ink color'),
    },
    effectHooks: Object.freeze(input.effectHooks || [
      'photograph', 'background-foil', 'subject-foil', 'edge-foil', 'editorial-pattern', 'rail', 'rarity', 'signature', 'serial',
    ]),
  }
  if (!Number.isFinite(recipe.source.width) || recipe.source.width <= 0 ||
      !Number.isFinite(recipe.source.height) || recipe.source.height <= 0) {
    throw new Error('Creator recipe requires real source dimensions')
  }
  return freezeDeep(recipe)
}

export function creatorCoverGeometry(recipe) {
  const { width, height, focalX, focalY } = recipe.source
  const region = { x: 148, y: 0, width: 876, height: 1536 }
  const scale = Math.max(region.width / width, region.height / height)
  const renderedWidth = width * scale
  const renderedHeight = height * scale
  return Object.freeze({
    x: region.x - (renderedWidth - region.width) * focalX,
    y: region.y - (renderedHeight - region.height) * focalY,
    width: renderedWidth,
    height: renderedHeight,
  })
}

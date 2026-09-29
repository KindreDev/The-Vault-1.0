export const HOF_RARITIES = Object.freeze(['C', 'R', 'SR', 'UR', 'SPR'])
export const HOF_PERIOD_TYPES = Object.freeze(['day', 'week', 'month', 'alltime'])

function periodType(value, boardLabel) {
  const normalized = String(value || '').trim().toLowerCase()
  if (HOF_PERIOD_TYPES.includes(normalized)) return normalized
  const label = String(boardLabel || '').trim().toLowerCase().replace(/ hall of fame$/, '')
  const inferred = { daily: 'day', weekly: 'week', monthly: 'month', 'all-time': 'alltime', 'all time': 'alltime' }[label]
  if (!inferred) throw new Error('Hall of Fame recipe requires a real board period type')
  return inferred
}

function required(value, field) {
  const result = String(value ?? '').trim()
  if (!result) throw new Error(`Hall of Fame recipe requires real ${field} data`)
  return result
}

function positiveId(value, field) {
  const result = Number(value)
  if (!Number.isInteger(result) || result <= 0) throw new Error(`Hall of Fame recipe requires a real ${field}`)
  return result
}

function optionalPositiveId(value, field) {
  if (value == null || value === '') return null
  return positiveId(value, field)
}

function freezeDeep(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  Object.values(value).forEach(freezeDeep)
  return Object.freeze(value)
}

export function createHallOfFameRecipe(input) {
  const rarity = required(input.rarity, 'rarity').toUpperCase()
  if (!HOF_RARITIES.includes(rarity)) throw new Error(`Unsupported Hall of Fame rarity: ${rarity}`)
  const snapshot = input.snapshot || {}
  const source = input.source || {}
  const sourceKind = ['image', 'avatar', 'placeholder'].includes(source.kind) ? source.kind : 'image'
  const recipe = {
    schema: 'vault.hall-of-fame-card-recipe', version: 2,
    cardType: 'hall-of-fame', templateId: 'hall-of-fame-honor-materials-v2', rarity,
    snapshot: {
      creatorId: optionalPositiveId(snapshot.creatorId, 'creator ID'),
      creatorName: required(snapshot.creatorName, 'creator name'),
      creatorTypeLabel: required(snapshot.creatorTypeLabel, 'creator type'),
      awardCategory: ['creator', 'media', 'gallery', 'legacy'].includes(snapshot.awardCategory)
        ? snapshot.awardCategory : 'legacy',
      galleryName: String(snapshot.galleryName || '').trim() || null,
      boardLabel: required(snapshot.boardLabel, 'board label'),
      periodType: periodType(snapshot.periodType, snapshot.boardLabel),
      periodLabel: required(snapshot.periodLabel, 'winning period'),
      cardId: required(snapshot.cardId, 'card ID'),
      mintedAt: required(snapshot.mintedAt, 'mint timestamp'),
    },
    source: {
      kind: sourceKind,
      imageId: sourceKind === 'image' ? positiveId(source.imageId, 'source image ID') : null,
      creatorId: sourceKind === 'avatar' || sourceKind === 'placeholder'
        ? optionalPositiveId(source.creatorId, 'source creator ID') : null,
      historicalImageId: source.historicalImageId == null
        ? null : positiveId(source.historicalImageId, 'historical image ID'),
      width: Number(source.width), height: Number(source.height),
      focalX: Math.min(1, Math.max(0, Number(source.focalX ?? 0.5))),
      focalY: Math.min(1, Math.max(0, Number(source.focalY ?? 0.2))),
    },
    effectHooks: Object.freeze(input.effectHooks || [
      'photograph', 'background-foil', 'subject-foil', 'edge-foil',
      'frame', 'ornaments', 'rarity', 'text', 'signature',
    ]),
  }
  const validSource = recipe.source.kind === 'image'
    ? Boolean(recipe.source.imageId)
    : Boolean(
      recipe.source.creatorId && recipe.source.creatorId === recipe.snapshot.creatorId
    ) || (recipe.source.kind === 'placeholder' && recipe.snapshot.awardCategory !== 'creator')
  if (!validSource || !Number.isFinite(recipe.source.width) || recipe.source.width <= 0 ||
      !Number.isFinite(recipe.source.height) || recipe.source.height <= 0) {
    throw new Error('Hall of Fame recipe requires a valid image, avatar, or placeholder source')
  }
  return freezeDeep(recipe)
}

export function hallOfFameCoverGeometry(recipe) {
  const region = { x: 0, y: 0, width: 1024, height: 1536 }
  const { width, height, focalX, focalY } = recipe.source
  const scale = Math.max(region.width / width, region.height / height)
  const renderedWidth = width * scale
  const renderedHeight = height * scale
  return Object.freeze({
    x: -(renderedWidth - region.width) * focalX,
    y: -(renderedHeight - region.height) * focalY,
    width: renderedWidth, height: renderedHeight,
  })
}

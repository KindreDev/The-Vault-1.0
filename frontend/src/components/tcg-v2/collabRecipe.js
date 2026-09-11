export const COLLAB_RARITIES = Object.freeze(['C', 'R', 'SR', 'UR', 'SPR'])

function required(value, field) {
  const result = String(value ?? '').trim()
  if (!result) throw new Error(`Collab recipe requires real ${field} data`)
  return result
}

function positiveId(value, field) {
  const result = Number(value)
  if (!Number.isInteger(result) || result <= 0) throw new Error(`Collab recipe requires a real ${field}`)
  return result
}

function color(value, field) {
  const result = required(value, field).toUpperCase()
  if (!/^#[0-9A-F]{6}$/.test(result)) throw new Error(`Invalid Collab ${field}`)
  return result
}

function freezeDeep(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  Object.values(value).forEach(freezeDeep)
  return Object.freeze(value)
}

export function createCollabRecipe(input) {
  const rarity = required(input.rarity, 'rarity').toUpperCase()
  if (!COLLAB_RARITIES.includes(rarity)) throw new Error(`Unsupported Collab rarity: ${rarity}`)
  const snapshot = input.snapshot || {}
  const source = input.source || {}
  const palette = input.palette || {}
  const creatorIds = (snapshot.creatorIds || []).map(value => positiveId(value, 'creator ID'))
  const creatorNames = (snapshot.creatorNames || []).map(value => required(value, 'creator name'))
  if (creatorIds.length < 2 || creatorIds.length !== creatorNames.length) {
    throw new Error('Collab recipe requires at least two real creators')
  }
  const recipe = {
    schema: 'vault.collab-card-recipe', version: 2, cardType: 'collab',
    rarity, templateId: 'collab-gift-frame-v1',
    snapshot: {
      subtype: required(snapshot.subtype, 'subtype'), creatorIds, creatorNames,
      characterNames: (snapshot.characterNames || []).map(value => String(value || '').trim() || null),
      galleryName: String(snapshot.galleryName || '').trim() || null,
      topLabel: String(snapshot.topLabel || '').trim() || null,
      bannerLabel: required(snapshot.bannerLabel, 'participant label'),
      periodLabel: String(snapshot.periodLabel || '').trim() || null,
      cardId: required(snapshot.cardId, 'card ID'), mintedAt: required(snapshot.mintedAt, 'mint timestamp'),
    },
    source: {
      kind: 'image', imageId: positiveId(source.imageId, 'source image ID'),
      width: Number(source.width), height: Number(source.height),
      focalX: Math.min(1, Math.max(0, Number(source.focalX ?? 0.5))),
      focalY: Math.min(1, Math.max(0, Number(source.focalY ?? 0.2))),
    },
    palette: {
      primary: color(palette.primary, 'primary color'), secondary: color(palette.secondary, 'secondary color'),
      pop: color(palette.pop, 'pop color'), ink: color(palette.ink, 'ink color'),
    },
    effectHooks: Object.freeze(input.effectHooks || ['photograph', 'background-foil', 'subject-foil', 'edge-foil', 'frame', 'rarity', 'signature']),
  }
  if (!Number.isFinite(recipe.source.width) || recipe.source.width <= 0 ||
      !Number.isFinite(recipe.source.height) || recipe.source.height <= 0) {
    throw new Error('Collab recipe requires real source dimensions')
  }
  return freezeDeep(recipe)
}

export function collabCoverGeometry(recipe) {
  const { width, height, focalX, focalY } = recipe.source
  const scale = Math.max(1024 / width, 1536 / height)
  const renderedWidth = width * scale
  const renderedHeight = height * scale
  return Object.freeze({
    x: -(renderedWidth - 1024) * focalX, y: -(renderedHeight - 1536) * focalY,
    width: renderedWidth, height: renderedHeight,
  })
}

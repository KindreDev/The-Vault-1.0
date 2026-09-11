export const COSPLAY_RARITIES = Object.freeze(['C', 'R', 'SR', 'UR', 'SPR'])
export const COSPLAY_MOTIFS = Object.freeze([
  'blossom', 'star', 'heart', 'flame', 'moon', 'crown', 'note', 'paw', 'aperture',
])

function required(value, field) {
  const result = String(value ?? '').trim()
  if (!result) throw new Error(`Cosplay recipe requires real ${field} data`)
  return result
}

function positiveId(value, field) {
  const result = Number(value)
  if (!Number.isInteger(result) || result <= 0) throw new Error(`Cosplay recipe requires a real ${field}`)
  return result
}

function color(value, field) {
  const result = required(value, field).toUpperCase()
  if (!/^#[0-9A-F]{6}$/.test(result)) throw new Error(`Invalid Cosplay ${field}`)
  return result
}

function freezeDeep(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  Object.values(value).forEach(freezeDeep)
  return Object.freeze(value)
}

export function createCosplayRecipe(input) {
  const rarity = required(input.rarity, 'rarity').toUpperCase()
  if (!COSPLAY_RARITIES.includes(rarity)) throw new Error(`Unsupported Cosplay rarity: ${rarity}`)
  const snapshot = input.snapshot || {}
  const source = input.source || {}
  const palette = input.palette || {}
  const heroMotif = COSPLAY_MOTIFS.includes(input.heroMotif) ? input.heroMotif : 'blossom'
  const recipe = {
    schema: 'vault.cosplay-card-recipe',
    version: 2,
    cardType: 'cosplay',
    rarity,
    templateId: 'cosplay-comic-print-v1',
    snapshot: {
      creatorId: positiveId(snapshot.creatorId, 'creator ID'),
      creatorName: required(snapshot.creatorName, 'creator name'),
      creatorType: required(snapshot.creatorType, 'creator type'),
      characterId: positiveId(snapshot.characterId, 'character ID'),
      characterName: required(snapshot.characterName, 'character name'),
      series: String(snapshot.series || '').trim() || null,
      galleryName: String(snapshot.galleryName || '').trim() || null,
      topLabel: required(snapshot.topLabel, 'franchise cosplay label'),
      pairingLabel: required(snapshot.pairingLabel, 'creator and character pairing'),
      periodLabel: String(snapshot.periodLabel || '').trim() || null,
      cardId: required(snapshot.cardId, 'card ID'),
      mintedAt: required(snapshot.mintedAt, 'mint timestamp'),
    },
    source: {
      kind: 'image',
      imageId: positiveId(source.imageId, 'source image ID'),
      width: Number(source.width), height: Number(source.height),
      focalX: Math.min(1, Math.max(0, Number(source.focalX ?? 0.5))),
      focalY: Math.min(1, Math.max(0, Number(source.focalY ?? 0.2))),
    },
    palette: {
      primary: color(palette.primary, 'primary color'),
      secondary: color(palette.secondary, 'secondary color'),
      pop: color(palette.pop, 'pop color'),
      ink: color(palette.ink, 'ink color'),
    },
    heroMotif,
    effectHooks: Object.freeze(input.effectHooks || ['photograph', 'background-foil', 'subject-foil', 'edge-foil', 'frame', 'motifs', 'rarity', 'signature']),
  }
  if (!Number.isFinite(recipe.source.width) || recipe.source.width <= 0 ||
      !Number.isFinite(recipe.source.height) || recipe.source.height <= 0) {
    throw new Error('Cosplay recipe requires real source dimensions')
  }
  return freezeDeep(recipe)
}

export function cosplayCoverGeometry(recipe) {
  const { width, height, focalX, focalY } = recipe.source
  const scale = Math.max(1024 / width, 1536 / height)
  const renderedWidth = width * scale
  const renderedHeight = height * scale
  return Object.freeze({
    x: -(renderedWidth - 1024) * focalX,
    y: -(renderedHeight - 1536) * focalY,
    width: renderedWidth,
    height: renderedHeight,
  })
}

export const CHARACTER_RARITIES = Object.freeze(['C', 'R', 'SR', 'UR', 'SPR'])

function text(value, field) {
  const result = String(value ?? '').trim()
  if (!result) throw new Error(`Character recipe requires real ${field} data`)
  return result
}

function color(value, field) {
  const result = text(value, field).toUpperCase()
  if (!/^#[0-9A-F]{6}$/.test(result)) throw new Error(`Invalid Character ${field}`)
  return result
}

function freezeDeep(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  Object.values(value).forEach(freezeDeep)
  return Object.freeze(value)
}

export function createCharacterRecipe(input) {
  const rarity = text(input.rarity, 'rarity').toUpperCase()
  if (!CHARACTER_RARITIES.includes(rarity)) throw new Error(`Unsupported Character rarity: ${rarity}`)
  const snapshot = input.snapshot || input
  const source = input.source || input
  const palette = input.palette || {}
  const requestedCutout = input.visualMode === 'cutout' || input.templateId === 'character-pop-art-v1'
  const visualMode = requestedCutout && input.maskMetrics?.accepted ? 'cutout' : 'full-bleed'
  const recipe = {
    schema: 'vault.character-card-recipe',
    version: 1,
    cardType: 'character',
    rarity,
    templateId: visualMode === 'cutout' ? 'character-pop-art-v1' : 'character-full-bleed-v1',
    visualMode,
    snapshot: {
      characterId: Number(snapshot.characterId),
      characterName: text(snapshot.characterName, 'character name'),
      series: String(snapshot.series || '').trim() || null,
      cardId: text(snapshot.cardId, 'card ID'),
      mintedAt: text(snapshot.mintedAt, 'mint timestamp'),
    },
    source: {
      kind: source.kind === 'avatar' ? 'avatar' : 'image',
      imageId: source.imageId == null ? null : Number(source.imageId),
      characterId: source.characterId == null ? null : Number(source.characterId),
      width: Number(source.width),
      height: Number(source.height),
      focalX: Math.min(1, Math.max(0, Number(source.focalX ?? 0.5))),
      focalY: Math.min(1, Math.max(0, Number(source.focalY ?? 0.25))),
    },
    palette: {
      background: color(palette.background, 'background color'),
      primary: color(palette.primary, 'primary color'),
      secondary: color(palette.secondary, 'secondary color'),
      ink: color(palette.ink, 'ink color'),
    },
    orbIcon: text(input.orbIcon || 'star', 'orb icon'),
    extraction: input.extraction || { status: visualMode === 'cutout' ? 'usable' : 'fallback' },
    maskMetrics: { ...(input.maskMetrics || {}) },
    effectHooks: Object.freeze(input.effectHooks || ['background', 'background-foil', 'subject', 'subject-foil', 'edge-foil', 'frame', 'rarity', 'signature', 'orb']),
  }
  if (!Number.isInteger(recipe.snapshot.characterId) || recipe.snapshot.characterId <= 0) {
    throw new Error('Character recipe requires a real character ID')
  }
  const validSource = recipe.source.kind === 'image'
    ? Number.isInteger(recipe.source.imageId) && recipe.source.imageId > 0
    : Number.isInteger(recipe.source.characterId) && recipe.source.characterId > 0
  if (!validSource || !Number.isFinite(recipe.source.width) || recipe.source.width <= 0 ||
      !Number.isFinite(recipe.source.height) || recipe.source.height <= 0) {
    throw new Error('Character recipe requires a real source image and dimensions')
  }
  return freezeDeep(recipe)
}

export function characterCoverGeometry(recipe) {
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

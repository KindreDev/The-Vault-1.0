export const GALLERY_RARITIES = Object.freeze(['C', 'R', 'SR', 'UR', 'SPR'])

function required(value, field) {
  const result = String(value ?? '').trim()
  if (!result) throw new Error(`Gallery recipe requires real ${field} data`)
  return result
}

function positiveId(value, field) {
  const result = Number(value)
  if (!Number.isInteger(result) || result <= 0) throw new Error(`Gallery recipe requires a real ${field}`)
  return result
}

function color(value, field) {
  const result = required(value, field).toUpperCase()
  if (!/^#[0-9A-F]{6}$/.test(result)) throw new Error(`Invalid Gallery ${field}`)
  return result
}

function freezeDeep(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  Object.values(value).forEach(freezeDeep)
  return Object.freeze(value)
}

export function createGalleryRecipe(input) {
  const rarity = required(input.rarity, 'rarity').toUpperCase()
  if (!GALLERY_RARITIES.includes(rarity)) throw new Error(`Unsupported Gallery rarity: ${rarity}`)
  const snapshot = input.snapshot || {}
  const source = input.source || {}
  const palette = input.palette || {}
  const stackSources = (input.stackSources || []).slice(0, 3).map((item, index) => {
    const width = Number(item.width)
    const height = Number(item.height)
    if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
      throw new Error('Gallery stack requires real source dimensions')
    }
    return {
      imageId: positiveId(item.imageId, `stack image ID ${index + 1}`),
      width, height,
      focalX: Math.min(1, Math.max(0, Number(item.focalX ?? 0.5))),
      focalY: Math.min(1, Math.max(0, Number(item.focalY ?? 0.2))),
      offsetX: Number(item.offsetX || 0),
      offsetY: Number(item.offsetY || 0),
      rotation: Number(item.rotation || 0),
    }
  })
  const creatorId = snapshot.creatorId == null ? null : positiveId(snapshot.creatorId, 'creator ID')
  const creatorName = String(snapshot.creatorName || '').trim() || null
  if (Boolean(creatorId) !== Boolean(creatorName)) {
    throw new Error('Gallery creator ID and name must either both exist or both be absent')
  }
  if (rarity === 'SPR' && !creatorName) {
    throw new Error('SPR Gallery recipes require a creator name for their signature')
  }
  const recipe = {
    schema: 'vault.gallery-card-recipe', version: 3, cardType: 'gallery',
    rarity, templateId: 'gallery-scrapbook-polaroid-v1',
    snapshot: {
      galleryId: positiveId(snapshot.galleryId, 'gallery ID'),
      galleryName: required(snapshot.galleryName, 'gallery name'),
      creatorId, creatorName,
      creatorType: String(snapshot.creatorType || '').trim() || null,
      creatorTypeLabel: String(snapshot.creatorTypeLabel || '').trim() || null,
      periodLabel: String(snapshot.periodLabel || '').trim() || null,
      cardId: required(snapshot.cardId, 'card ID'),
      mintedAt: required(snapshot.mintedAt, 'mint timestamp'),
    },
    source: {
      kind: 'image', imageId: positiveId(source.imageId, 'source image ID'),
      width: Number(source.width), height: Number(source.height),
      focalX: Math.min(1, Math.max(0, Number(source.focalX ?? 0.5))),
      focalY: Math.min(1, Math.max(0, Number(source.focalY ?? 0.2))),
    },
    stackSources,
    palette: {
      background: color(palette.background, 'background color'),
      primary: color(palette.primary, 'primary color'),
      secondary: color(palette.secondary, 'secondary color'),
      ink: color(palette.ink, 'ink color'),
    },
    effectHooks: Object.freeze(input.effectHooks || ['photograph-stack', 'photograph', 'background-foil', 'subject-foil', 'edge-foil', 'paper', 'polaroid', 'tape', 'motifs', 'rarity', 'text', 'signature']),
  }
  if (!Number.isFinite(recipe.source.width) || recipe.source.width <= 0 ||
      !Number.isFinite(recipe.source.height) || recipe.source.height <= 0) {
    throw new Error('Gallery recipe requires real source dimensions')
  }
  return freezeDeep(recipe)
}

export function galleryPhotoGeometry(recipe) {
  return gallerySourceGeometry(recipe.source)
}

export function gallerySourceGeometry(source, target = { x: 89, y: 222, width: 846, height: 1044 }) {
  const { width, height, focalX, focalY } = source
  const scale = Math.max(target.width / width, target.height / height)
  const renderedWidth = width * scale
  const renderedHeight = height * scale
  return Object.freeze({
    x: target.x - (renderedWidth - target.width) * focalX,
    y: target.y - (renderedHeight - target.height) * focalY,
    width: renderedWidth,
    height: renderedHeight,
    target,
  })
}

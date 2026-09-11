export const SCENE_CANVAS = Object.freeze({ width: 1024, height: 1536 })
export const SCENE_RARITIES = Object.freeze(['C', 'R', 'SR', 'UR', 'SPR'])

const monthNames = Object.freeze([
  'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN',
  'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC',
])

function requiredText(value, field) {
  const text = String(value ?? '').trim()
  if (!text) throw new Error(`Scene recipe requires real ${field} data`)
  return text
}

function finiteDimension(value, field) {
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0) {
    throw new Error(`Scene recipe requires a valid ${field}`)
  }
  return number
}

function freezeDeep(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  Object.values(value).forEach(freezeDeep)
  return Object.freeze(value)
}

export function formatScenePeriod({ periodLabel, periodMonth, periodYear }) {
  if (periodLabel) return requiredText(periodLabel, 'period label').toUpperCase()
  const month = Number(periodMonth)
  const year = Number(periodYear)
  if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(year)) {
    throw new Error('Scene recipe requires a real period label or month/year pair')
  }
  return `${monthNames[month - 1]} ${year}`
}

export function createSceneRecipe(input) {
  const rarity = requiredText(input.rarity, 'rarity').toUpperCase()
  if (!SCENE_RARITIES.includes(rarity)) throw new Error(`Unsupported Scene rarity: ${rarity}`)
  const maskMetrics = { ...(input.maskMetrics || {}) }
  const requestedMode = String(input.visualMode || '').toLowerCase()
  const visualMode = requestedMode === 'layered' && maskMetrics.accepted ? 'layered' : 'flat'
  const failureReason = visualMode === 'layered'
    ? null
    : (input.extraction?.failureReason || maskMetrics.reasons?.join(',') || 'mask-not-available')

  const snapshot = input.snapshot || input
  const source = input.source || input
  const outline = input.outline || input
  const recipe = {
    schema: 'vault.scene-card-recipe',
    version: 1,
    templateId: 'scene-floral-outline-v1',
    cardType: 'scene',
    rarity,
    visualMode,
    snapshot: {
      creatorName: requiredText(snapshot.creatorName, 'creator name'),
      creatorType: requiredText(snapshot.creatorType, 'creator type'),
      subjectName: requiredText(snapshot.subjectName, 'subject name'),
      periodLabel: formatScenePeriod(snapshot),
      cardId: requiredText(snapshot.cardId, 'card ID'),
      mintedAt: requiredText(snapshot.mintedAt, 'mint timestamp'),
    },
    source: {
      imageId: Number.isInteger(source.imageId) ? source.imageId : null,
      width: finiteDimension(source.width ?? source.sourceWidth, 'source width'),
      height: finiteDimension(source.height ?? source.sourceHeight, 'source height'),
      focalX: Math.min(1, Math.max(0, Number(source.focalX ?? 0.5))),
      focalY: Math.min(1, Math.max(0, Number(source.focalY ?? 0.5))),
    },
    outline: {
      primary: requiredText(outline.primary ?? outline.outlinePrimary, 'primary outline color'),
      secondary: requiredText(outline.secondary ?? outline.outlineSecondary, 'secondary outline color'),
    },
    extraction: {
      status: visualMode === 'layered' ? 'usable' : 'fallback',
      failureReason,
      pipelineVersion: requiredText(
        input.extraction?.pipelineVersion || 'scene-mask-hybrid-v2', 'mask pipeline version'
      ),
    },
    maskMetrics,
    effectHooks: Object.freeze(input.effectHooks || [
      'photograph', 'background-foil', 'subject-foil', 'edge-foil',
      'outline', 'frame', 'rarity', 'text', 'signature',
    ]),
  }
  return freezeDeep(recipe)
}

export function sceneMetadata(recipe) {
  const { periodLabel, cardId } = recipe.snapshot
  return `SCENE  •  ${periodLabel}  •  ${cardId}`
}

export function sceneCoverGeometry(recipe) {
  const { width, height, focalX, focalY } = recipe.source
  const scale = Math.max(SCENE_CANVAS.width / width, SCENE_CANVAS.height / height)
  const renderedWidth = width * scale
  const renderedHeight = height * scale
  return Object.freeze({
    x: -(renderedWidth - SCENE_CANVAS.width) * focalX,
    y: -(renderedHeight - SCENE_CANVAS.height) * focalY,
    width: renderedWidth,
    height: renderedHeight,
  })
}

export function sceneTextLayout(recipe) {
  const creatorLength = [...recipe.snapshot.creatorName].length
  const subjectLength = [...recipe.snapshot.subjectName.replace(/\s+/g, '')].length
  const metadataLength = [...sceneMetadata(recipe)].length
  return Object.freeze({
    creatorFontSize: creatorLength <= 14 ? 52 : creatorLength <= 22 ? 44 : creatorLength <= 30 ? 36 : 32,
    creatorCompress: creatorLength > 22,
    roleFontSize: 31,
    metadataFontSize: metadataLength <= 34 ? 31 : metadataLength <= 44 ? 28 : 25,
    metadataCompress: metadataLength > 44,
    subjectMode: subjectLength <= 12 ? 'stacked' : 'rotated',
    subjectFontSize: subjectLength <= 8 ? 62 : subjectLength <= 12 ? 54 : 48,
  })
}

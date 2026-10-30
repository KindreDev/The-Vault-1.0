import { LocalizedText } from '../../i18n'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Html, useTexture } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import TCGV2CardFace from '../tcg-v2/TCGV2CardFace'
import { resolveTCGV2CardFace } from '../tcg-v2/cardFaceResolver'
import { sceneCoverGeometry } from '../tcg-v2/sceneRecipe'
import { characterCoverGeometry } from '../tcg-v2/characterRecipe'
import { cosplayCoverGeometry } from '../tcg-v2/cosplayRecipe'
import { collabCoverGeometry } from '../tcg-v2/collabRecipe'
import { creatorCoverGeometry } from '../tcg-v2/creatorRecipe'
import { galleryPhotoGeometry, gallerySourceGeometry } from '../tcg-v2/galleryRecipe'
import { bondCoverGeometry } from '../tcg-v2/bondRecipe'
import { hallOfFameCoverGeometry } from '../tcg-v2/hallOfFameRecipe'
import { ROOM_CARD_FRAGMENT_SHADER, ROOM_CARD_VERTEX_SHADER, roomCardMaterialMode } from './roomCardMaterial'
import { roomQualityProfile } from './roomQuality'

const CARD_WIDTH = .0756
const CARD_HEIGHT = .1056
const CLEAR_LAYER = Object.freeze({ sleeve: .0022, toploader: .004, acrylic_case: .008 })
const RARITY_VALUE = Object.freeze({ C: 0, R: 1, SR: 2, SPR: 3, UR: 4 })
// Data URLs of card art are large, so keep only the most recently used ones.
// Frames, fonts and other shared assets stay warm because they are reused.
const EMBEDDED_ASSET_CACHE_LIMIT = 96
const embeddedAssetCache = new Map()
// Face captures are heavy (React render, CSS scan, three canvas rasters), so
// run only a couple at a time instead of every card at once.
const MAX_ACTIVE_CAPTURES = 2
const SVG_WAIT_ATTEMPTS = 40
const SVG_WAIT_MS = 250
let activeCaptures = 0
const captureWaiters = []

function acquireCaptureSlot() {
  return new Promise(resolve => {
    const tryStart = () => {
      if (activeCaptures < MAX_ACTIVE_CAPTURES) { activeCaptures += 1; resolve() } else captureWaiters.push(tryStart)
    }
    tryStart()
  })
}

function releaseCaptureSlot() {
  activeCaptures = Math.max(0, activeCaptures - 1)
  captureWaiters.shift()?.()
}

const sleep = ms => new Promise(resolve => window.setTimeout(resolve, ms))

// Each raster is one long main-thread task.  Start them in the gaps between
// frames so walking stays smooth while cards prepare.
const whenIdle = () => new Promise(resolve => {
  if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(() => resolve(), { timeout: 1200 })
  else window.setTimeout(resolve, 40)
})

const GEOMETRY_RESOLVERS = Object.freeze({
  scene: sceneCoverGeometry, character: characterCoverGeometry, cosplay: cosplayCoverGeometry,
  collab: collabCoverGeometry, creator: creatorCoverGeometry, gallery: galleryPhotoGeometry,
  bond: bondCoverGeometry, 'hall-of-fame': hallOfFameCoverGeometry,
})

function maskGeometry(face) {
  const resolver = GEOMETRY_RESOLVERS[face?.type]
  if (!resolver) return [0, 0, 1, 1]
  const geometry = resolver(face.recipe)
  return [geometry.x / 1024, geometry.y / 1536, geometry.width / 1024, geometry.height / 1536]
}

function absoluteAssetUrl(value, base = window.location.href) {
  const trimmed = String(value || '').trim()
  if (!trimmed || /^(?:data:|blob:|https?:|#)/i.test(trimmed)) return trimmed
  return new URL(trimmed, base).href
}

function absoluteSvgAssets(svg) {
  svg.querySelectorAll('[href]').forEach(node => {
    const href = node.getAttribute('href')
    if (href) node.setAttribute('href', absoluteAssetUrl(href))
  })
}

function blobDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

function embeddedAsset(url) {
  if (embeddedAssetCache.has(url)) {
    // Refresh recency.
    const cached = embeddedAssetCache.get(url)
    embeddedAssetCache.delete(url)
    embeddedAssetCache.set(url, cached)
  } else {
    while (embeddedAssetCache.size >= EMBEDDED_ASSET_CACHE_LIMIT) embeddedAssetCache.delete(embeddedAssetCache.keys().next().value)
    embeddedAssetCache.set(url, fetch(url).then(response => {
      if (!response.ok) throw new Error(`Card asset returned ${response.status}: ${url}`)
      return response.blob()
    }).then(blobDataUrl).catch(error => {
      embeddedAssetCache.delete(url)
      throw error
    }))
  }
  return embeddedAssetCache.get(url)
}

async function waitForImageDecode(src) {
  const image = new Image()
  image.decoding = 'async'
  image.src = src
  try {
    await image.decode()
    return
  } catch {
    // Some WebView2 builds reject decode() even after the image has loaded.
    // Do not wait forever for an onload event that already happened.
    if (image.complete) return
  }
  await new Promise(resolve => {
    image.onload = resolve
    image.onerror = resolve
  })
}

async function inlineSvgImages(svg) {
  await Promise.all([...svg.querySelectorAll('image[href]')].map(async node => {
    const href = node.getAttribute('href')
    if (!href || href.startsWith('data:') || href.startsWith('#')) return
    node.setAttribute('href', await embeddedAsset(href))
  }))
}

async function waitForSvgImages(svg) {
  await Promise.all([...svg.querySelectorAll('image[href]')].map(async node => {
    const href = node.getAttribute('href')
    if (!href || href.startsWith('#')) return
    await waitForImageDecode(href)
  }))
}

async function inlineCssAssets(text, base) {
  const refs = []
  text.replace(/url\(\s*(['"]?)([^'"\)]+)\1\s*\)/gi, (match, _quote, asset) => {
    const value = asset.trim()
    if (value && !value.startsWith('#') && !value.startsWith('data:')) refs.push({ match, value })
    return match
  })
  let result = text
  for (const ref of refs) {
    const dataUrl = await embeddedAsset(absoluteAssetUrl(ref.value, base))
    result = result.replaceAll(ref.match, `url("${dataUrl}")`)
  }
  return result
}

function ruleAppliesToSvg(rule, svg) {
  if (rule.type === 5) return true // @font-face
  if (rule.type !== 1 || !rule.selectorText) return false
  try {
    if (svg.matches(rule.selectorText) || svg.querySelector(rule.selectorText)) return true
  } catch { /* Ancestor and pseudo selectors need the class fallback below. */ }
  const classes = [...rule.selectorText.matchAll(/\.([A-Za-z0-9_-]+)/g)].map(match => match[1])
  return classes.some(name => svg.getAttribute('class')?.split(/\s+/).includes(name) || svg.querySelector(`.${CSS.escape(name)}`))
}

// Scanning every app stylesheet rule against a card SVG costs tens of
// milliseconds, and cards of the same type need the same rules.  Cache the
// result by the classes and element names the SVG uses.
const STYLE_CACHE_LIMIT = 64
const styleTextCache = new Map()

function svgStyleSignature(svg) {
  const names = new Set([svg.tagName.toLowerCase()])
  for (const value of (svg.getAttribute('class') || '').split(/\s+/)) if (value) names.add(`.${value}`)
  svg.querySelectorAll('*').forEach(node => {
    names.add(node.tagName.toLowerCase())
    const classes = node.getAttribute('class')
    if (classes) for (const value of classes.split(/\s+/)) if (value) names.add(`.${value}`)
  })
  return `${document.styleSheets.length}|${[...names].sort().join(' ')}`
}

function readableStyleSheetText(svg) {
  const key = svgStyleSignature(svg)
  if (!styleTextCache.has(key)) {
    while (styleTextCache.size >= STYLE_CACHE_LIMIT) styleTextCache.delete(styleTextCache.keys().next().value)
    const text = scanStyleSheets(svg)
    text.catch(() => styleTextCache.delete(key))
    styleTextCache.set(key, text)
  }
  return styleTextCache.get(key)
}

async function scanStyleSheets(svg) {
  const rules = []
  for (const sheet of document.styleSheets) {
    try {
      const base = sheet.href || window.location.href
      for (const rule of sheet.cssRules || []) {
        if (ruleAppliesToSvg(rule, svg)) rules.push(inlineCssAssets(rule.cssText, base))
      }
    } catch { /* Same-origin Vault sheets are sufficient. */ }
  }
  return (await Promise.all(rules)).join('\n')
}

// Non-visual SVG elements a kept layer may rely on.
const SVG_SUPPORT_TAGS = new Set(['defs', 'style', 'lineargradient', 'radialgradient', 'clippath', 'mask', 'filter', 'pattern', 'symbol', 'marker'])

function isolatedSvg(source, selector) {
  const svg = source.cloneNode(true)
  // Remove everything outside the chosen layer rather than hiding it: hidden
  // photos were still embedded and decoded, which made each mask cost as
  // much as the full face.
  for (const node of [...svg.querySelectorAll('*')]) {
    if (!node.isConnected) continue
    const tag = node.tagName?.toLowerCase()
    if (SVG_SUPPORT_TAGS.has(tag) || node.closest?.('defs')) continue
    if (node.matches?.(selector) || node.closest?.(selector) || node.querySelector?.(selector)) continue
    node.remove()
  }
  dropUnusedDefs(svg)
  return svg
}

function svgReferences(node) {
  const ids = []
  for (const attribute of node.attributes || []) {
    for (const match of attribute.value.matchAll(/url\(\s*['"]?#([^'")\s]+)/g)) ids.push(match[1])
    if ((attribute.name === 'href' || attribute.name === 'xlink:href') && attribute.value.startsWith('#')) ids.push(attribute.value.slice(1))
  }
  return ids
}

// After pruning, defs the kept layer never points at (often the photo) go too.
function dropUnusedDefs(svg) {
  const byId = new Map([...svg.querySelectorAll('[id]')].map(node => [node.id, node]))
  const used = new Set()
  const queue = []
  svg.querySelectorAll('*').forEach(node => { if (!node.closest('defs')) queue.push(...svgReferences(node)) })
  while (queue.length) {
    const id = queue.pop()
    if (used.has(id)) continue
    used.add(id)
    const target = byId.get(id)
    if (!target) continue
    queue.push(...svgReferences(target))
    target.querySelectorAll('*').forEach(child => queue.push(...svgReferences(child)))
  }
  for (const defs of svg.querySelectorAll('defs')) {
    for (const child of [...defs.children]) {
      if (child.tagName.toLowerCase() === 'style') continue
      const keep = (child.id && used.has(child.id)) || [...child.querySelectorAll('[id]')].some(node => used.has(node.id))
      if (!keep) child.remove()
    }
  }
}

async function rasterTexture(svg, { opaque = false, resolution = 1024, anisotropy = 16, styleText = null } = {}) {
  const width = Math.max(1, Math.round(resolution))
  const height = Math.max(1, Math.round(width * 1.5))
  svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  svg.setAttribute('width', String(width)); svg.setAttribute('height', String(height))
  // Runtime shine surfaces use CSS-backed foreignObjects. The room shader
  // recreates those effects from the separated masks, and keeping them in the
  // baked face can taint the canvas and make protected cards render black.
  // HOF video artwork is the one exception: a 3D texture cannot animate, so
  // preserve its explicit poster frame instead of leaving the card face empty.
  svg.querySelectorAll('foreignObject').forEach(node => {
    const video = node.querySelector('video')
    const poster = video?.getAttribute('poster')
    if (!poster) {
      node.remove()
      return
    }
    const image = document.createElementNS('http://www.w3.org/2000/svg', 'image')
    for (const attribute of ['x', 'y', 'width', 'height']) {
      const value = node.getAttribute(attribute)
      if (value != null) image.setAttribute(attribute, value)
    }
    image.setAttribute('href', absoluteAssetUrl(poster))
    image.setAttribute('preserveAspectRatio', 'xMidYMid slice')
    image.setAttribute('data-effect-layer', node.getAttribute('data-effect-layer') || 'photograph')
    node.replaceWith(image)
  })
  absoluteSvgAssets(svg)
  await inlineSvgImages(svg)
  // The SVG clone now contains data URLs, but the browser can still begin
  // rasterizing before those replacement images have decoded. That race is
  // especially visible with animated WebP HOF previews: the room gets a
  // valid card shell with a black face. Wait for the final embedded assets,
  // not only the detached React source node, before creating the texture.
  await waitForSvgImages(svg)
  const style = document.createElementNS('http://www.w3.org/2000/svg', 'style')
  style.textContent = styleText ?? await readableStyleSheetText(svg)
  svg.prepend(style)
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml;charset=utf-8' }))
    const image = new Image()
    image.onload = () => {
      const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height
      const context = canvas.getContext('2d', { alpha: !opaque })
      if (opaque) { context.fillStyle = '#111018'; context.fillRect(0, 0, canvas.width, canvas.height) }
      context.drawImage(image, 0, 0, canvas.width, canvas.height)
      const texture = new THREE.CanvasTexture(canvas)
      texture.colorSpace = opaque ? THREE.SRGBColorSpace : THREE.NoColorSpace
      texture.anisotropy = anisotropy; texture.needsUpdate = true
      URL.revokeObjectURL(objectUrl); resolve(texture)
    }
    image.onerror = error => { URL.revokeObjectURL(objectUrl); reject(error) }
    image.src = objectUrl
  })
}

// Masks drive highlight placement only, so half resolution is plenty.
const MASK_SCALE = .5

// Card art points at the original file, which can be many megabytes.  A room
// texture is at most 1024 px wide, so bake from the server's resized preview
// (which also serves video posters and keeps GIFs animated) instead.
const FULL_FILE = /^\/api\/images\/(\d+)\/file$/
const previewWidth = resolution => (resolution > 768 ? 1440 : 1080)

function previewUrl(value, width) {
  return typeof value === 'string' && FULL_FILE.test(value) ? value.replace(FULL_FILE, `/api/images/$1/preview?w=${width}`) : value
}

function withPreviewArt(card, resolution) {
  const width = previewWidth(resolution)
  const walk = (value, depth) => {
    if (Array.isArray(value)) return depth > 3 ? value : value.map(item => walk(item, depth + 1))
    if (value && typeof value === 'object') return depth > 3 ? value : Object.fromEntries(Object.entries(value).map(([key, item]) => [key, walk(item, depth + 1)]))
    return previewUrl(value, width)
  }
  return walk(card, 0)
}

// Faces that build their own art URLs (gallery stacks) are caught here.
function swapSvgPreviewArt(svg, resolution) {
  const width = previewWidth(resolution)
  svg.querySelectorAll('image').forEach(node => {
    for (const attribute of ['href', 'xlink:href']) {
      const value = node.getAttribute(attribute)
      const next = previewUrl(value, width)
      if (next !== value) node.setAttribute(attribute, next)
    }
  })
}

/**
 * Bakes a card face (and, once wanted, its two foil masks) into textures.
 * When masks are asked for after the face already exists, only the masks are
 * rendered and the face is kept.
 */
function CardFaceTexture({ card, captureKey, onTextures, includeMasks = true, hasFace = false, resolution = 1024, anisotropy = 16 }) {
  const hasFaceRef = useRef(hasFace)
  hasFaceRef.current = hasFace
  useLayoutEffect(() => {
    const masksOnly = includeMasks && hasFaceRef.current
    let cancelled = false
    const host = document.createElement('div')
    host.className = 'tcg-room-card-capture'
    host.setAttribute('aria-hidden', 'true')
    document.body.appendChild(host)
    const root = createRoot(host)
    // A physical room card is a baked texture, not a live video surface.
    // Use the reliable poster frame here; the full inspector still receives
    // videoPresentation="full" and plays the original video.
    root.render(<TCGV2CardFace card={withPreviewArt(card, resolution)} width={resolution} showEffects={false} videoPresentation="poster" />)
    const capture = async () => {
      await document.fonts?.ready
      // The face can take longer than one tick to draw its SVG (lazy layers,
      // slow images). Keep checking instead of giving up and leaving the
      // card blank for the rest of the visit.
      let source = null
      for (let attempt = 0; attempt < SVG_WAIT_ATTEMPTS && !cancelled; attempt += 1) {
        source = host.querySelector('svg')
        if (source) break
        await sleep(SVG_WAIT_MS)
      }
      if (!source || cancelled) return
      swapSvgPreviewArt(source, resolution)
      // Card faces can contain image-backed collage layers.  Capturing the
      // SVG as soon as React has mounted it races those layers and leaves the
      // physical card's face at its dark body material (the compact stand then
      // looks like it has a black, empty inset).  Let every embedded image
      // finish decoding before taking the authoritative snapshot.
      const embeddedImages = [...source.querySelectorAll('image')]
      await Promise.all(embeddedImages.map(async imageNode => {
        const href = imageNode.getAttribute('href') || imageNode.getAttributeNS('http://www.w3.org/1999/xlink', 'href')
        if (!href || href.startsWith('#')) return
        await waitForImageDecode(absoluteAssetUrl(href))
      }))
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      if (cancelled) return
      // The face and both masks come from the same SVG, so the stylesheet
      // scan is shared (and cached across cards of the same type).
      const styleText = await readableStyleSheetText(source)
      // One raster at a time, each in an idle gap, so no single frame has to
      // absorb all three.
      const made = []
      const raster = async (svg, options) => {
        await whenIdle()
        if (cancelled) return null
        const texture = await rasterTexture(svg, { anisotropy, styleText, ...options })
        made.push(texture)
        return texture
      }
      const face = masksOnly ? null : await raster(source.cloneNode(true), { opaque: true, resolution })
      const maskResolution = Math.round(resolution * MASK_SCALE)
      const mask = selector => (includeMasks && source.querySelector(selector)
        ? raster(isolatedSvg(source, selector), { resolution: maskResolution })
        : null)
      const frameMask = await mask('[data-effect-layer="frame"]')
      const rarityMask = await mask('[data-effect-layer="rarity"]')
      if (cancelled) { made.forEach(texture => texture.dispose()); return }
      onTextures(masksOnly ? { frameMask, rarityMask } : { face, frameMask, rarityMask })
    }
    const timer = window.setTimeout(async () => {
      await acquireCaptureSlot()
      await whenIdle()
      try {
        if (!cancelled) await capture()
      } catch (error) {
        if (import.meta.env.DEV) console.error('[TCG room card] SVG capture failed', error)
      } finally {
        releaseCaptureSlot()
      }
    }, 220)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
      root.unmount()
      host.remove()
    }
  }, [captureKey, includeMasks, onTextures, resolution, anisotropy])
  return null
}

function neutralTexture(value) {
  const channel = Math.round(THREE.MathUtils.clamp(value, 0, 1) * 255)
  const texture = new THREE.DataTexture(new Uint8Array([channel, channel, channel, 255]), 1, 1)
  texture.colorSpace = THREE.NoColorSpace
  texture.needsUpdate = true
  return texture
}

function useOptionalTexture(url, fallbackValue, anisotropy = 1) {
  const [texture, setTexture] = useState(null)
  useEffect(() => {
    let active = true
    if (!url) {
      setTexture(previous => { previous?.dispose(); return neutralTexture(fallbackValue) })
      return () => { active = false }
    }
    const loader = new THREE.TextureLoader()
    loader.load(url, next => {
      if (!active) { next.dispose(); return }
      next.colorSpace = THREE.NoColorSpace
      next.wrapS = next.wrapT = THREE.ClampToEdgeWrapping
      next.anisotropy = anisotropy
      setTexture(previous => { previous?.dispose(); return next })
    }, undefined, () => setTexture(null))
    return () => { active = false }
  }, [anisotropy, fallbackValue, url])
  useEffect(() => () => texture?.dispose(), [texture])
  return texture
}

function GalleryAngleArt({ face, active }) {
  const layers = (face?.recipe?.stackSources || []).map((source, index) => ({
    source, url: face.stackArtUrls?.[index] || (source.imageId ? `/api/images/${source.imageId}/file` : null),
  })).filter(layer => layer.url).slice(0, 2)
  if (!active || layers.length < 2) return null
  return <>{layers.map((layer, index) => <GalleryAnglePlane key={`${layer.source.imageId}-${layer.url}`} {...layer} direction={index ? 1 : -1} />)}</>
}

function GalleryAnglePlane({ url, source, direction }) {
  const sharedMap = useTexture(url)
  const geometry = useMemo(() => gallerySourceGeometry(source), [source])
  const map = useMemo(() => {
    const clone = sharedMap.clone()
    const target = geometry.target
    const repeatX = target.width / geometry.width
    const repeatY = target.height / geometry.height
    clone.repeat.set(repeatX, repeatY)
    clone.offset.set((target.x - geometry.x) / geometry.width,
      1 - (target.y - geometry.y) / geometry.height - repeatY)
    clone.wrapS = clone.wrapT = THREE.ClampToEdgeWrapping
    clone.colorSpace = THREE.SRGBColorSpace
    clone.needsUpdate = true
    return clone
  }, [geometry, sharedMap])
  const materialRef = useRef(null)
  const meshRef = useRef(null)
  const worldPoint = useMemo(() => new THREE.Vector3(), [])
  const view = useMemo(() => new THREE.Vector3(), [])
  const tangent = useMemo(() => new THREE.Vector3(), [])
  const { camera } = useThree()
  useEffect(() => () => map.dispose(), [map])
  useFrame(() => {
    if (!meshRef.current || !materialRef.current) return
    meshRef.current.getWorldPosition(worldPoint)
    view.copy(camera.position).sub(worldPoint).normalize()
    tangent.set(1, 0, 0).transformDirection(meshRef.current.matrixWorld)
    materialRef.current.opacity = Math.max(0, direction * tangent.dot(view) - .16) * .9
  })
  // The 2D Gallery face scales its 846x1044 photo window by .88 and rotates
  // that polaroid -2 degrees around (512,760). Mirror that exact window in
  // card-local coordinates; only the cropped photograph can angle-fade.
  const width = CARD_WIDTH * (846 / 1024) * .88
  const height = CARD_HEIGHT * (1044 / 1536) * .88
  const centerY = 744
  return <mesh ref={meshRef}
      position={[0, CARD_HEIGHT * ((768 - (760 + (centerY - 760) * .88)) / 1536), .0038]}
      rotation={[0, 0, THREE.MathUtils.degToRad(2)]}>
    <planeGeometry args={[width, height]} />
    <meshBasicMaterial ref={materialRef} map={map} transparent opacity={0} depthWrite={false} toneMapped={false} />
  </mesh>
}

function ProtectiveLayer({ kind }) {
  const thickness = CLEAR_LAYER[kind]
  if (!thickness) return null
  return <mesh position={[0, 0, thickness * .55]}>
    <boxGeometry args={[CARD_WIDTH + thickness * 4, CARD_HEIGHT + thickness * 4, thickness]} />
    {/* No transmission: it would re-render the whole room every frame for a
        sliver of plastic.  Alpha plus clearcoat reads the same at this size. */}
    <meshPhysicalMaterial color="#dfeaff" transparent opacity={kind === 'acrylic_case' ? .2 : .12} depthWrite={false}
      roughness={.08} metalness={0} clearcoat={1} clearcoatRoughness={.06} />
  </mesh>
}

// Graded slab used by the wall slab rack: a clear case around the card with a
// label above it showing the card name and its grade.
const SLAB = Object.freeze({ width: .084, height: .136, depth: .010, lift: .0134, labelWidth: .076, labelHeight: .019 })
const GRADE_SCORE = Object.freeze({ S: 10, A: 9, B: 8, C: 7, D: 6 })
const LABEL_FONT = 'Inter, "Segoe UI", system-ui, sans-serif'

function fittedText(context, text, maxWidth) {
  if (context.measureText(text).width <= maxWidth) return text
  let value = text
  while (value.length > 1 && context.measureText(`${value}…`).width > maxWidth) value = value.slice(0, -1)
  return `${value.trimEnd()}…`
}

function slabLabelTexture(title, grade) {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 128
  const context = canvas.getContext('2d')
  const background = context.createLinearGradient(0, 0, canvas.width, 0)
  background.addColorStop(0, '#1d1626')
  background.addColorStop(1, '#2b2137')
  context.fillStyle = background
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.strokeStyle = '#c9a25a'
  context.lineWidth = 6
  context.strokeRect(6, 6, canvas.width - 12, canvas.height - 12)
  context.textBaseline = 'middle'
  context.fillStyle = '#f3e7cf'
  context.font = `600 34px ${LABEL_FONT}`
  context.fillText(fittedText(context, title || 'Vault card', 330), 26, 48)
  context.fillStyle = '#b9a98c'
  context.font = `600 22px ${LABEL_FONT}`
  context.fillText(grade ? `THE VAULT · GRADE ${grade}` : 'THE VAULT · UNGRADED', 26, 92)
  context.textAlign = 'right'
  context.fillStyle = '#e8c472'
  context.font = `800 66px ${LABEL_FONT}`
  context.fillText(grade ? String(GRADE_SCORE[grade] ?? grade) : '–', canvas.width - 26, 68)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 4
  return texture
}

function SlabCase({ title, grade }) {
  const label = useMemo(() => slabLabelTexture(title, grade), [title, grade])
  useEffect(() => () => label.dispose(), [label])
  return <group position={[0, SLAB.lift, 0]}>
    <mesh position={[0, SLAB.height / 2 - .0035 - SLAB.labelHeight / 2, SLAB.depth / 2 + .0003]}>
      <planeGeometry args={[SLAB.labelWidth, SLAB.labelHeight]} />
      <meshBasicMaterial map={label} toneMapped={false} />
    </mesh>
    <mesh renderOrder={5}>
      <boxGeometry args={[SLAB.width, SLAB.height, SLAB.depth]} />
      <meshPhysicalMaterial color="#e4eeff" transparent opacity={.14} depthWrite={false}
        roughness={.06} metalness={0} clearcoat={1} clearcoatRoughness={.05} />
    </mesh>
  </group>
}

function LiveFoilSurface({ item, face, faceTexture, surfaceTextures, mode, faceOffset, quality }) {
  const materialRef = useRef(null)
  const { camera } = useThree()
  const packedMask = useOptionalTexture(item.card.mask_url, 0, quality.anisotropy)
  const foilMap = useOptionalTexture(item.card.foil_map_url, .52, quality.anisotropy)
  const uniforms = useMemo(() => ({
    uFace: { value: faceTexture }, uPackedMask: { value: packedMask || foilMap }, uFoilMap: { value: foilMap || packedMask },
    uFrameMask: { value: surfaceTextures?.frameMask || packedMask },
    uRarityMask: { value: surfaceTextures?.rarityMask || packedMask },
    uHasMask: { value: packedMask && item.card.mask_url ? 1 : 0 },
    uHasFoilMap: { value: foilMap && item.card.foil_map_url ? 1 : 0 },
    uRarity: { value: RARITY_VALUE[mode.rarity] || 0 }, uHasSurfaceMasks: { value: surfaceTextures ? 1 : 0 }, uTime: { value: 0 },
    uReactive: { value: mode.reactive ? 1 : 0 }, uCameraPosition: { value: new THREE.Vector3() },
    uKeyLight: { value: new THREE.Vector3(-.25, .9, .35).normalize() },
    uMaskGeometry: { value: new THREE.Vector4(...maskGeometry(face)) },
  }), [face, faceTexture, foilMap, item.card.foil_map_url, item.card.mask_url, mode.rarity, mode.reactive, packedMask, surfaceTextures])
  useFrame(state => {
    uniforms.uTime.value = state.clock.elapsedTime
    uniforms.uCameraPosition.value.copy(camera.position)
  })
  // The baked face is the authoritative card visual: never fall back to the
  // dark card body.  Without a subject mask (or while it loads) show the face
  // directly.  The foil map is optional; the shader uses a neutral relief, so
  // mask-ready R/SR/SPR cards still get their holo instead of a flat print.
  if (!item.card.mask_url || !packedMask || !foilMap) {
    return <mesh position={[0, 0, -faceOffset]}>
      <planeGeometry args={[CARD_WIDTH, CARD_HEIGHT]} />
      <meshBasicMaterial map={faceTexture} toneMapped={false} side={THREE.DoubleSide} />
    </mesh>
  }
  return <mesh position={[0, 0, -faceOffset]}>
    <planeGeometry args={[CARD_WIDTH, CARD_HEIGHT]} />
    <shaderMaterial key={`${item.copy.id}-${faceTexture.uuid}-${packedMask.uuid}-${foilMap.uuid}`} ref={materialRef} uniforms={uniforms} vertexShader={ROOM_CARD_VERTEX_SHADER}
      fragmentShader={ROOM_CARD_FRAGMENT_SHADER} transparent toneMapped={false} side={THREE.DoubleSide} />
  </mesh>
}

export default function RoomCardSurface({ item, position, rotation, scale = 1, distance = 0, quality = 'high', faceSide = 1, flipHorizontal = false, facePlanePosition = null, holder = null, onTextureReady }) {
  const [surfaceTextures, setSurfaceTextures] = useState(null)
  const qualityProfile = roomQualityProfile(quality)
  const faceTexture = surfaceTextures?.face || null
  const displayFaceTexture = useMemo(() => {
    if (!faceTexture || !flipHorizontal) return faceTexture
    const clone = faceTexture.clone()
    clone.repeat.x = -1
    clone.offset.x = 1
    clone.needsUpdate = true
    return clone
  }, [faceTexture, flipHorizontal])
  const groupRef = useRef(null)
  const { camera } = useThree()
  const carriedForward = useMemo(() => new THREE.Vector3(), [])
  const carriedRight = useMemo(() => new THREE.Vector3(), [])
  const carriedUp = useMemo(() => new THREE.Vector3(), [])
  const captureKey = useMemo(() => JSON.stringify([
    item.card.id, item.card.rarity_class, item.card.image_url, item.card.mask_url,
    item.card.foil_map_url, item.card.presentation_override,
    item.card.scene_visual, item.card.character_visual, item.card.cosplay_visual,
    item.card.collab_visual, item.card.creator_visual, item.card.gallery_visual,
    item.card.bond_visual, item.card.hof_visual,
  ]), [item.card])
  const face = useMemo(() => resolveTCGV2CardFace(item.card), [captureKey])
  const mode = useMemo(() => roomCardMaterialMode(item.card, distance), [distance, item.card])
  // Live foil follows the real camera distance.  Hysteresis stops it
  // flickering at the threshold, and once a card's foil masks have been
  // captured they are kept, so walking back and forth never re-captures.
  const [liveFoil, setLiveFoil] = useState(false)
  const [masksWanted, setMasksWanted] = useState(false)
  const foilState = useRef({ near: false, measured: false, tick: Math.floor(Math.random() * 12) })
  const worldPoint = useMemo(() => new THREE.Vector3(), [])
  const readyRef = useRef(onTextureReady)
  readyRef.current = onTextureReady
  const faceOffset = facePlanePosition ?? (.0032 * (faceSide < 0 ? -1 : 1))
  useEffect(() => { if (faceTexture) readyRef.current?.() }, [faceTexture])
  useEffect(() => () => Object.values(surfaceTextures || {}).forEach(texture => texture?.dispose()), [surfaceTextures])
  useEffect(() => () => {
    if (displayFaceTexture && displayFaceTexture !== faceTexture) displayFaceTexture.dispose()
  }, [displayFaceTexture, faceTexture])
  useFrame(() => {
    const state = foilState.current
    state.tick += 1
    if (groupRef.current && (!state.measured || state.tick % 12 === 0)) {
      state.measured = true
      groupRef.current.getWorldPosition(worldPoint)
      const gap = worldPoint.distanceTo(camera.position)
      const near = state.near ? gap < qualityProfile.foilDistance + .6 : gap < qualityProfile.foilDistance
      if (near !== state.near) {
        state.near = near
        setLiveFoil(near)
        if (near) setMasksWanted(true)
      }
    }
    if (groupRef.current && item.surface === 'carried') {
      // Keep the held card offset in camera space. The previous world-space
      // [.14, -.34, 0] offset made it sweep sideways whenever the player
      // looked around, which read as violent card motion in the inspector.
      camera.getWorldDirection(carriedForward)
      carriedRight.setFromMatrixColumn(camera.matrixWorld, 0).normalize()
      carriedUp.setFromMatrixColumn(camera.matrixWorld, 1).normalize()
      groupRef.current.position.copy(camera.position)
        .addScaledVector(carriedForward, .58)
        .addScaledVector(carriedRight, .14)
        .addScaledVector(carriedUp, -.34)
      groupRef.current.quaternion.copy(camera.quaternion)
    }
  })
  // A mask-only update keeps the face; anything replaced is released.
  const receiveTextures = useCallback(next => setSurfaceTextures(previous => {
    for (const [key, texture] of Object.entries(previous || {})) if (key in next && next[key] !== texture) texture?.dispose()
    return { ...(previous || {}), ...next }
  }), [])
  return <group ref={groupRef} position={position} rotation={rotation} scale={scale}
    userData={{ physicalCopyId: item.copy.id, rarity: mode.rarity, interactionKey: `inspect-${item.copy?.id || item.preview?.card_id}` }}>
    <CardFaceTexture card={item.card} captureKey={captureKey} onTextures={receiveTextures} includeMasks={masksWanted} hasFace={Boolean(faceTexture)} resolution={qualityProfile.cardWidth} anisotropy={qualityProfile.cardAnisotropy} />
    <mesh castShadow receiveShadow>
      <boxGeometry args={[CARD_WIDTH, CARD_HEIGHT, .003]} />
      <meshStandardMaterial color="#17141a" roughness={.74} metalness={0} />
    </mesh>
    {displayFaceTexture && (liveFoil
      ? <LiveFoilSurface item={item} face={face} faceTexture={displayFaceTexture} surfaceTextures={surfaceTextures} mode={mode} faceOffset={faceOffset} quality={qualityProfile} />
      : <mesh position={[0, 0, -faceOffset]}><planeGeometry args={[CARD_WIDTH, CARD_HEIGHT]} /><meshBasicMaterial map={displayFaceTexture} toneMapped={false} side={THREE.DoubleSide} /></mesh>)}
    <GalleryAngleArt face={face} active={liveFoil && mode.galleryAngleStack} />
    <ProtectiveLayer kind={item.copy.location_kind} />
    {holder === 'slab' && <SlabCase title={item.preview?.title || item.card?.display_name} grade={item.copy?.grade} />}
  </group>
}

export function RoomCardPreparation({ item, position, rotation }) {
  return <group position={position} rotation={rotation}>
    <mesh><boxGeometry args={[CARD_WIDTH, CARD_HEIGHT, .005]} /><meshStandardMaterial color="#251d2e" roughness={.8} /></mesh>
    <Html transform position={[0, 0, .008]} center distanceFactor={1.2} className="tcg-room-card-preparing">
      <span>{item.preview?.rarity || 'R+'}</span><strong><LocalizedText text={"Preparing foil"} /></strong>
    </Html>
  </group>
}

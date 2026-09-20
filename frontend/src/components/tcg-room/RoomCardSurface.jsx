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
const embeddedAssetCache = new Map()

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
  if (!embeddedAssetCache.has(url)) {
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

async function inlineSvgImages(svg) {
  await Promise.all([...svg.querySelectorAll('image[href]')].map(async node => {
    const href = node.getAttribute('href')
    if (!href || href.startsWith('data:') || href.startsWith('#')) return
    node.setAttribute('href', await embeddedAsset(href))
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

async function readableStyleSheetText(svg) {
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

function isolatedSvg(source, selector) {
  const svg = source.cloneNode(true)
  svg.querySelectorAll('*').forEach(node => {
    const keep = node.tagName?.toLowerCase() === 'defs' || node.closest?.('defs') ||
      node.matches?.(selector) || node.closest?.(selector) || node.querySelector?.(selector)
    if (!keep) node.setAttribute('visibility', 'hidden')
  })
  return svg
}

async function rasterTexture(svg, { opaque = false, resolution = 1024, anisotropy = 16 } = {}) {
  const width = Math.max(1, Math.round(resolution))
  const height = Math.max(1, Math.round(width * 1.5))
  svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  svg.setAttribute('width', String(width)); svg.setAttribute('height', String(height))
  // Runtime shine surfaces use CSS-backed foreignObjects. The room shader
  // recreates those effects from the separated masks, and keeping them in the
  // baked face can taint the canvas and make protected cards render black.
  svg.querySelectorAll('foreignObject').forEach(node => node.remove())
  absoluteSvgAssets(svg)
  await inlineSvgImages(svg)
  const style = document.createElementNS('http://www.w3.org/2000/svg', 'style')
  style.textContent = await readableStyleSheetText(svg)
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

function CardFaceTexture({ card, captureKey, onTextures, includeMasks = true, resolution = 1024, anisotropy = 16 }) {
  useLayoutEffect(() => {
    let cancelled = false
    const host = document.createElement('div')
    host.className = 'tcg-room-card-capture'
    host.setAttribute('aria-hidden', 'true')
    document.body.appendChild(host)
    const root = createRoot(host)
    root.render(<TCGV2CardFace card={card} width={resolution} showEffects={false} />)
    const timer = window.setTimeout(async () => {
      await document.fonts?.ready
      const source = host.querySelector('svg')
      if (!source) return
      // Card faces can contain image-backed collage layers.  Capturing the
      // SVG as soon as React has mounted it races those layers and leaves the
      // physical card's face at its dark body material (the compact stand then
      // looks like it has a black, empty inset).  Let every embedded image
      // finish decoding before taking the authoritative snapshot.
      const embeddedImages = [...source.querySelectorAll('image')]
      await Promise.all(embeddedImages.map(async imageNode => {
        const href = imageNode.getAttribute('href') || imageNode.getAttributeNS('http://www.w3.org/1999/xlink', 'href')
        if (!href || href.startsWith('#')) return
        const probe = new Image()
        probe.src = absoluteAssetUrl(href)
        try { await probe.decode() } catch { await new Promise(resolve => { probe.onload = resolve; probe.onerror = resolve }) }
      }))
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      Promise.all([
        rasterTexture(source.cloneNode(true), { opaque: true, resolution, anisotropy }),
        ...(includeMasks ? [
          rasterTexture(isolatedSvg(source, '[data-effect-layer="frame"]'), { resolution, anisotropy }),
          rasterTexture(isolatedSvg(source, '[data-effect-layer="rarity"]'), { resolution, anisotropy }),
        ] : []),
      ]).then(([face, frameMask = null, rarityMask = null]) => {
        if (cancelled) { face.dispose(); frameMask?.dispose(); rarityMask?.dispose(); return }
        onTextures({ face, frameMask, rarityMask })
      }).catch(error => { if (import.meta.env.DEV) console.error('[TCG room card] SVG capture failed', error) })
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
    <meshPhysicalMaterial color="#dfeaff" transparent opacity={kind === 'acrylic_case' ? .16 : .09}
      roughness={.08} metalness={0} transmission={.82} thickness={.03} clearcoat={1} clearcoatRoughness={.06} />
  </mesh>
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
  // The baked face is the authoritative card visual.  A physical room card
  // must never fall back to its dark body just because optional foil maps are
  // absent (or still loading).  The previous null return made compact stands
  // render as a black blank card for cards without both maps.  Keep the
  // already-ready face texture as a deterministic, front-facing fallback;
  // once both optional maps exist the live foil shader takes over.
  // useOptionalTexture supplies a neutral 1x1 texture while an URL is absent,
  // so checking the loaded texture objects is insufficient here: both are
  // truthy even when this card has no authored foil maps.  Gate the shader on
  // the persisted sources themselves and show the baked face directly until
  // every optional effect source is genuinely available.
  if (!item.card.mask_url || !item.card.foil_map_url || !packedMask || !foilMap) {
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

export default function RoomCardSurface({ item, position, rotation, scale = 1, distance = 0, quality = 'high', faceSide = 1, flipHorizontal = false, facePlanePosition = null, onTextureReady }) {
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
  const liveFoil = distance <= qualityProfile.foilDistance
  const faceOffset = facePlanePosition ?? (.0032 * (faceSide < 0 ? -1 : 1))
  useEffect(() => { if (faceTexture) onTextureReady?.() }, [faceTexture, onTextureReady])
  useEffect(() => () => Object.values(surfaceTextures || {}).forEach(texture => texture?.dispose()), [surfaceTextures])
  // If a lower quality tier turns foil off, release any masks from the old
  // tier immediately instead of retaining them until the replacement face
  // snapshot finishes capturing.
  useEffect(() => {
    if (liveFoil) return
    setSurfaceTextures(previous => {
      if (!previous?.frameMask && !previous?.rarityMask) return previous
      previous.frameMask?.dispose(); previous.rarityMask?.dispose()
      return { ...previous, frameMask: null, rarityMask: null }
    })
  }, [liveFoil])
  useEffect(() => () => {
    if (displayFaceTexture && displayFaceTexture !== faceTexture) displayFaceTexture.dispose()
  }, [displayFaceTexture, faceTexture])
  useFrame(() => {
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
  const receiveTextures = useCallback(next => setSurfaceTextures(previous => { Object.values(previous || {}).forEach(texture => texture?.dispose()); return next }), [])
  return <group ref={groupRef} position={position} rotation={rotation} scale={scale}
    userData={{ physicalCopyId: item.copy.id, rarity: mode.rarity, interactionKey: `inspect-${item.copy?.id || item.preview?.card_id}` }}>
    <CardFaceTexture card={item.card} captureKey={captureKey} onTextures={receiveTextures} includeMasks={liveFoil} resolution={qualityProfile.cardWidth} anisotropy={qualityProfile.cardAnisotropy} />
    <mesh castShadow receiveShadow>
      <boxGeometry args={[CARD_WIDTH, CARD_HEIGHT, .003]} />
      <meshStandardMaterial color="#17141a" roughness={.74} metalness={0} />
    </mesh>
    {displayFaceTexture && (liveFoil
      ? <LiveFoilSurface item={item} face={face} faceTexture={displayFaceTexture} surfaceTextures={surfaceTextures} mode={mode} faceOffset={faceOffset} quality={qualityProfile} />
      : <mesh position={[0, 0, -faceOffset]}><planeGeometry args={[CARD_WIDTH, CARD_HEIGHT]} /><meshBasicMaterial map={displayFaceTexture} toneMapped={false} side={THREE.DoubleSide} /></mesh>)}
    <GalleryAngleArt face={face} active={liveFoil && mode.galleryAngleStack} />
    <ProtectiveLayer kind={item.copy.location_kind} />
  </group>
}

export function RoomCardPreparation({ item, position, rotation }) {
  return <group position={position} rotation={rotation}>
    <mesh><boxGeometry args={[CARD_WIDTH, CARD_HEIGHT, .005]} /><meshStandardMaterial color="#251d2e" roughness={.8} /></mesh>
    <Html transform position={[0, 0, .008]} center distanceFactor={1.2} className="tcg-room-card-preparing">
      <span>{item.preview?.rarity || 'R+'}</span><strong>Preparing foil</strong>
    </Html>
  </group>
}

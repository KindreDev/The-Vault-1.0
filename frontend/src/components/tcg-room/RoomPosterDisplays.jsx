import { useEffect, useMemo, useState } from 'react'
import * as THREE from 'three'
import { LED_DEFAULTS, POSTER_ASSETS, POSTER_FRAMES } from './roomLayout'

// Long side of a print texture in pixels.  Prints are drawn into a canvas
// with the frame opening's own aspect ratio, so nothing is ever stretched.
const PRINT_LONG_SIDE = 1024

// The server keeps resized previews at 720, 1080 and 1440 px only.
const PREVIEW_WIDTH = 1080

export function posterImageUrl(imageId) {
  return `/api/images/${encodeURIComponent(imageId)}/preview?w=${PREVIEW_WIDTH}`
}

/**
 * Draw a photo into a canvas shaped like the frame opening.  'contain' shows
 * the whole photo on a true-black matte (black, not grey, so the padding
 * reads as a deliberate letterbox); 'cover' fills the opening and crops the
 * overflow evenly.
 */
export function textureFromImage(image, frame = POSTER_FRAMES.poster_frame, fit = frame.fit) {
  const width = image.naturalWidth || image.width
  const height = image.naturalHeight || image.height
  const aspect = frame.width / frame.height
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(aspect >= 1 ? PRINT_LONG_SIDE : PRINT_LONG_SIDE * aspect)
  canvas.height = Math.round(aspect >= 1 ? PRINT_LONG_SIDE / aspect : PRINT_LONG_SIDE)
  const context = canvas.getContext('2d')
  context.fillStyle = '#000000'
  context.fillRect(0, 0, canvas.width, canvas.height)
  const scale = fit === 'cover'
    ? Math.max(canvas.width / width, canvas.height / height)
    : Math.min(canvas.width / width, canvas.height / height)
  const drawWidth = Math.max(1, Math.round(width * scale))
  const drawHeight = Math.max(1, Math.round(height * scale))
  context.drawImage(image, Math.round((canvas.width - drawWidth) / 2), Math.round((canvas.height - drawHeight) / 2), drawWidth, drawHeight)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 8
  texture.minFilter = THREE.LinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.generateMipmaps = false
  texture.needsUpdate = true
  return texture
}

/** Load a Vault photo as a print texture for one frame shape. */
export function usePosterTexture(imageId, frame, fit) {
  const [texture, setTexture] = useState(null)
  useEffect(() => {
    if (!imageId) return undefined
    let disposed = false
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.onload = () => {
      if (disposed) return
      try {
        const next = textureFromImage(image, frame, fit)
        setTexture(previous => { previous?.dispose(); return next })
      } catch {
        setTexture(previous => { previous?.dispose(); return null })
      }
    }
    image.onerror = () => { if (!disposed) setTexture(previous => { previous?.dispose(); return null }) }
    image.src = posterImageUrl(imageId)
    return () => { disposed = true; setTexture(previous => { previous?.dispose(); return null }) }
  }, [imageId, frame, fit])
  return texture
}

// One soft rounded glow shared by every lightbox; each box tints it.
let haloTexture = null
function lightboxHalo() {
  if (haloTexture) return haloTexture
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 256
  const context = canvas.getContext('2d')
  const gradient = context.createRadialGradient(128, 128, 40, 128, 128, 128)
  gradient.addColorStop(0, 'rgba(255,255,255,.9)')
  gradient.addColorStop(.45, 'rgba(255,255,255,.35)')
  gradient.addColorStop(1, 'rgba(255,255,255,0)')
  context.fillStyle = gradient
  context.fillRect(0, 0, 256, 256)
  haloTexture = new THREE.CanvasTexture(canvas)
  haloTexture.colorSpace = THREE.SRGBColorSpace
  return haloTexture
}

/** The photo plane for a frame, in the frame's own local space. */
export function PosterPrintPlane({ frame, texture, renderOrder = 3 }) {
  return <mesh position={[0, frame.y, frame.z + .0004]} renderOrder={renderOrder}>
    <planeGeometry args={[frame.width, frame.height]} />
    {/* Distinct keys: reusing the placeholder material and only adding a
        map leaves its shader compiled without one, so the print rendered
        as a blank white sheet whenever the image arrived after the first
        frame. */}
    {texture
      ? <meshBasicMaterial key={texture.uuid} map={texture} toneMapped={false} side={THREE.DoubleSide} />
      : <meshBasicMaterial key="placeholder" color="#1a1520" toneMapped={false} side={THREE.DoubleSide} />}
  </mesh>
}

function PosterPrint({ placement, assetId }) {
  const frame = POSTER_FRAMES[assetId]
  const content = placement.transform?.content || {}
  const fit = content.fit || frame.fit
  const texture = usePosterTexture(content.image_id, frame, fit)
  const p = placement.transform?.position || {}
  const r = placement.transform?.rotation || {}
  const glowColor = frame.glow ? (content.led_color || LED_DEFAULTS[assetId]) : null
  return <group position={[p.x || 0, p.y || 0, p.z || 0]} rotation={[r.x || 0, r.y || 0, r.z || 0]}>
    {content.image_id && <PosterPrintPlane frame={frame} texture={texture} />}
    {/* Backlit glow spilling onto the wall around a lightbox. */}
    {glowColor && <mesh position={[0, frame.y, -.032]} renderOrder={2}>
      <planeGeometry args={[frame.width + .7, frame.height + .7]} />
      <meshBasicMaterial map={lightboxHalo()} color={glowColor} transparent opacity={.55} depthWrite={false}
        blending={THREE.AdditiveBlending} toneMapped={false} />
    </mesh>}
  </group>
}

export default function RoomPosterDisplays({ bootstrap, activeInstanceId = null }) {
  const posters = useMemo(() => (bootstrap?.room?.placements || []).map(row => {
    if (row.instance_id === activeInstanceId) return null
    const instance = bootstrap?.owned_instances?.find(value => value.id === row.instance_id)
    const definition = bootstrap?.catalog?.find(value => value.id === instance?.definition_id)
    if (!POSTER_ASSETS.has(definition?.asset_id)) return null
    if (!row.transform?.content?.image_id && !POSTER_FRAMES[definition.asset_id].glow) return null
    return { row, assetId: definition.asset_id }
  }).filter(Boolean), [activeInstanceId, bootstrap])
  return <group name="vault-posters">
    {posters.map(item => <PosterPrint key={`${item.row.instance_id}-${item.row.transform?.content?.image_id}-${item.row.transform?.content?.fit}`}
      placement={item.row} assetId={item.assetId} />)}
  </group>
}

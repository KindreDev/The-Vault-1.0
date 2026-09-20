import { useEffect, useMemo } from 'react'
import { useGLTF, useTexture } from '@react-three/drei'
import { AUTHORED_FURNITURE, BLUE_BOXES, FURNITURE_FILE, SURFACE_HOST_ASSETS, standMeshScale } from './roomLayout'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import * as THREE from 'three'
import { roomQualityProfile } from './roomQuality'

const PALETTE = Object.freeze({
  wall_paint: { color: '#f2eee6', roughness: .88 },
  light_wood: { color: '#b9824f', roughness: .72 },
  dark_wood: { color: '#5b3526', roughness: .68 },
  carpet: { color: '#75628f', roughness: .96 },
  black_metal: { color: '#24252b', roughness: .35, metalness: .72 },
  chrome: { color: '#bbc5ce', roughness: .2, metalness: .92 },
  cabinet_glass: { color: '#b9e7e4', roughness: .12, metalness: .05, transparent: true, opacity: .32 },
  clear_acrylic: { color: '#d7f3f5', roughness: .08, transparent: true, opacity: .4 },
  binder_leather: { color: '#6d294b', roughness: .62 },
  binder_canvas: { color: '#315f73', roughness: .9 },
  binder_vinyl: { color: '#7b68b3', roughness: .48 },
  card_paper: { color: '#f4ead7', roughness: .72 },
  cardboard: { color: '#b88955', roughness: .86 },
  booster_foil: { color: '#9e79cf', roughness: .28, metalness: .48 },
  hard_plastic: { color: '#343846', roughness: .52 },
  bedding_fabric: { color: '#d8a6b9', roughness: .94 },
  led_emissive: { color: '#79dce2', roughness: .32, emissive: '#268e9e', emissiveIntensity: 1.35 },
  poster_paper: { color: '#d596b2', roughness: .78 },
})

const TEXTURED_MATERIALS = Object.freeze([
  'wall_paint', 'light_wood', 'dark_wood', 'carpet', 'black_metal', 'chrome',
  'binder_leather', 'binder_canvas', 'binder_vinyl', 'cardboard',
  'hard_plastic', 'bedding_fabric', 'poster_paper',
])

function createVaultMonitorTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = 640
  canvas.height = 360
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#0b0d16'; ctx.fillRect(0, 0, 640, 360)
  ctx.fillStyle = '#171a2a'; ctx.fillRect(0, 0, 640, 42)
  ctx.fillStyle = '#8f86f2'; ctx.fillRect(0, 0, 7, 360)
  ctx.fillStyle = '#f2efff'; ctx.font = '700 19px Arial'; ctx.fillText('VAULT OS', 24, 28)
  ctx.fillStyle = '#a7a4c9'; ctx.font = '13px Arial'; ctx.fillText('PRIVATE COLLECTION', 162, 27)
  ctx.fillStyle = '#242840'; ctx.fillRect(24, 62, 376, 106)
  ctx.fillStyle = '#7f77dd'; ctx.font = '700 13px Arial'; ctx.fillText('COLLECTION ROOM', 42, 88)
  ctx.fillStyle = '#f2efff'; ctx.font = '700 22px Arial'; ctx.fillText('Your Vault is ready', 42, 120)
  ctx.fillStyle = '#aaa9bf'; ctx.font = '12px Arial'; ctx.fillText('Browse cards, binders and sealed booster packs', 42, 145)
  ctx.fillStyle = '#1c2032'; ctx.fillRect(420, 62, 196, 106)
  ctx.fillStyle = '#d4537e'; ctx.font = '700 12px Arial'; ctx.fillText('TODAY', 438, 88)
  ctx.fillStyle = '#fff'; ctx.font = '700 25px Arial'; ctx.fillText('12', 438, 122)
  ctx.fillStyle = '#9fa0b8'; ctx.font = '12px Arial'; ctx.fillText('cards on display', 478, 121)
  ctx.fillStyle = '#171a28'; ctx.fillRect(24, 190, 592, 130)
  const cards = [ '#7f77dd', '#d4537e', '#ba7517', '#1d9e75' ]
  cards.forEach((color, index) => {
    const x = 42 + index * 108
    ctx.fillStyle = color; ctx.fillRect(x, 212, 78, 83)
    ctx.fillStyle = 'rgba(255,255,255,.82)'; ctx.fillRect(x + 8, 222, 62, 8)
    ctx.fillStyle = 'rgba(255,255,255,.24)'; ctx.fillRect(x + 8, 242, 48, 5); ctx.fillRect(x + 8, 254, 58, 5)
  })
  ctx.fillStyle = '#8f86f2'; ctx.font = '12px Arial'; ctx.fillText('RECENTLY ACQUIRED', 42, 310)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 2
  texture.needsUpdate = true
  return texture
}

/** A single inexpensive baked canvas pass for the physical PC monitor. */
export function VaultMonitorScreen({ position, rotation = [0, 0, 0], size }) {
  const texture = useMemo(createVaultMonitorTexture, [])
  useEffect(() => () => texture.dispose(), [texture])
  return <mesh position={position} rotation={rotation} renderOrder={4}>
    <planeGeometry args={size} />
    <meshBasicMaterial map={texture} toneMapped={false} polygonOffset polygonOffsetFactor={-1} polygonOffsetUnits={-1} />
  </mesh>
}

const BASE_ROOM_URL = '/tcg-room/base_room.glb'

function isCollideMesh(name) {
  const n = (name || '').replace(/^BAKE_/, '')
  if (/window|monitor|keyboard|aobox|roof|glass|circle/i.test(n)) return false
  return /room|floor2|desk|door|defaultmaterial/i.test(n)
}

/** Live apartment shell. Native glTF materials, no PALETTE remap, no shop furniture. */
export function AuthoredBaseRoom({ quality = 'medium', onLoaded }) {
  const { scene } = useGLTF(BASE_ROOM_URL)
  const profile = roomQualityProfile(quality)
  const root = useMemo(() => {
    const value = scene.clone(true)
    value.name = 'authored-base-room'
    value.traverse(node => {
      if (!node.isMesh) return
      const glass = /glass/i.test(node.material?.name || '') || /window/i.test(node.name)
      node.castShadow = profile.shadows && !glass && !/floor/i.test(node.name)
      node.receiveShadow = true
      node.userData.collide = isCollideMesh(node.name)
      node.userData.placeSurface = /desk|defaultmaterial/i.test(node.name)
      if (/BAKE_(Room|Floor|Roof)/.test(node.name) && node.material && !node.material.userData.vaultSided) {
        node.material.side = THREE.DoubleSide
        node.material.userData.vaultSided = true
      }
    })
    return value
  }, [profile.shadows, scene])
  useEffect(() => { onLoaded?.(1) }, [onLoaded])
  return <primitive object={root} />
}

useGLTF.preload(BASE_ROOM_URL)

function canonicalMaterial(material) {
  const raw = Array.isArray(material) ? material[0]?.name : material?.name
  const name = (raw || 'hard_plastic').replace(/\.\d{3}$/, '')
  return PALETTE[name] ? name : 'hard_plastic'
}

function inNamedRoot(node, marker) {
  let current = node
  while (current) {
    if (current.name?.includes(marker)) return true
    current = current.parent
  }
  return false
}

function itemMatrix(item) {
  const scale = Array.isArray(item.scale) ? new THREE.Vector3(...item.scale) : new THREE.Vector3().setScalar(item.scale || 1)
  return new THREE.Matrix4().compose(
    new THREE.Vector3(...item.position),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...item.rotation)),
    scale,
  )
}

const WORLD_UV_ASSETS = Object.freeze(new Set([
  'room_floor', 'room_ceiling', 'wall_north', 'wall_south_windowed', 'wall_east', 'wall_west_door',
]))

const UV_PER_METER = Object.freeze({
  carpet: 1.15, wall_paint: .28, dark_wood: 2.4,
})

function applyWorldUVs(geometry, materialId) {
  const tiles = UV_PER_METER[materialId] || 1.2
  const pos = geometry.attributes.position
  const nrm = geometry.attributes.normal
  const uv = new Float32Array(pos.count * 2)
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i)
    const nx = Math.abs(nrm.getX(i)), ny = Math.abs(nrm.getY(i)), nz = Math.abs(nrm.getZ(i))
    if (ny >= nx && ny >= nz) { uv[i * 2] = x * tiles; uv[i * 2 + 1] = z * tiles }
    else if (nx >= nz) { uv[i * 2] = z * tiles; uv[i * 2 + 1] = y * tiles }
    else { uv[i * 2] = x * tiles; uv[i * 2 + 1] = y * tiles }
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
}

function preparedGeometry(source, matrix, materialId, useWorldUv) {
  let geometry = source.clone()
  for (const key of Object.keys(geometry.attributes)) {
    if (!['position', 'normal', 'uv'].includes(key)) geometry.deleteAttribute(key)
  }
  if (!geometry.attributes.normal) geometry.computeVertexNormals()
  if (!geometry.attributes.uv) geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(geometry.attributes.position.count * 2), 2))
  geometry.applyMatrix4(matrix)
  if (geometry.index) {
    const unindexed = geometry.toNonIndexed()
    geometry.dispose()
    geometry = unindexed
  }
  if (useWorldUv) applyWorldUVs(geometry, materialId)
  return geometry
}

function buildMergedRoom(items, assetScenes) {
  const buckets = new Map()
  items.forEach(item => {
    const scene = assetScenes.get(item.assetId)
    if (!scene) return
    scene.updateMatrixWorld(true)
    const hasLod1 = Boolean(scene.getObjectByName(`${item.assetId}_LOD1_ROOT`))
    const placement = itemMatrix(item)
    scene.traverse(node => {
      if (!node.isMesh || node.name.startsWith('UCX_')) return
      if (hasLod1 && inNamedRoot(node, 'LOD0_ROOT')) return
      if (!hasLod1 && inNamedRoot(node, 'LOD1_ROOT')) return
      // The GLB already has a cyan emissive slab; the OS plane replaces it.
      if (item.assetId === 'pc_monitor' && node.name.includes('_screen')) return
      // Posters are printed paper in a frame, not glass-fronted displays.
      // The authored poster asset includes a clear acrylic face; omit that
      // mesh so it cannot tint, desaturate, or add reflections over the print.
      if (item.assetId === 'poster_frame' && /glass|acrylic/i.test(node.name || '')) return
      let materialId = canonicalMaterial(node.material)
      // The floor GLB paints its field as light_wood. Treat that field as carpet
      // so the room reads as a bedroom, not a gymnasium of veneer.
      if (item.assetId === 'room_floor' && materialId === 'light_wood') materialId = 'carpet'
      const geometry = preparedGeometry(node.geometry, placement.clone().multiply(node.matrixWorld), materialId, WORLD_UV_ASSETS.has(item.assetId))
      buckets.set(materialId, [...(buckets.get(materialId) || []), geometry])
    })
  })
  return [...buckets.entries()].map(([materialId, geometries]) => {
    const geometry = mergeGeometries(geometries, false)
    geometries.forEach(value => value.dispose())
    if (!geometry) throw new Error(`Could not merge room geometry for ${materialId}`)
    geometry.computeBoundingSphere()
    return { materialId, geometry }
  })
}

function createMaterials(textureMap) {
  return new Map(Object.entries(PALETTE).map(([id, values]) => [id, new THREE.MeshStandardMaterial({
    ...values,
    ...(textureMap.get(id) ? {
      color: '#ffffff',
      map: textureMap.get(id).base,
      normalMap: textureMap.get(id).normal,
      roughnessMap: textureMap.get(id).roughness,
      normalScale: new THREE.Vector2(id === 'wall_paint' ? .22 : .4, id === 'wall_paint' ? .22 : .4),
      roughness: values.roughness,
      metalness: id === 'chrome' ? .92 : id === 'black_metal' ? .78 : (values.metalness || 0),
    } : {}),
    side: id === 'wall_paint' ? THREE.DoubleSide : THREE.FrontSide,
    depthWrite: !values.transparent,
  })]))
}

/**
 * The complete authored room is baked into one geometry per shared material.
 * Assets remain mounted for the whole visit: no distance/frustum React churn,
 * no per-placement geometry/material/texture clones, and no furniture pop-in.
 */
export function MergedRoomAssets({ version, items, quality = 'medium', onLoaded }) {
  const profile = roomQualityProfile(quality)
  const assetIds = useMemo(() => [...new Set(items.map(item => item.assetId))].sort(), [items])
  const urls = useMemo(() => assetIds.map(id => `/api/tcg-room/module/assets/${encodeURIComponent(version)}/assets/${id}.glb`), [assetIds, version])
  const loaded = useGLTF(urls, true)
  const materialUrls = useMemo(() => TEXTURED_MATERIALS.flatMap(id => ['base_color', 'normal', 'roughness'].map(kind =>
    `/api/tcg-room/module/assets/${encodeURIComponent(version)}/materials/${id}/${id}_${kind}.png`)), [version])
  const materialTextures = useTexture(materialUrls)
  const textureMap = useMemo(() => new Map(TEXTURED_MATERIALS.map((id, index) => [id, {
    base: materialTextures[index * 3],
    normal: materialTextures[index * 3 + 1],
    roughness: materialTextures[index * 3 + 2],
  }])), [materialTextures])
  const scenes = useMemo(() => new Map(assetIds.map((id, index) => [id, loaded[index].scene])), [assetIds, loaded])
  useEffect(() => {
    textureMap.forEach(({ base, normal, roughness }, id) => {
      base.colorSpace = THREE.SRGBColorSpace
      normal.colorSpace = THREE.NoColorSpace
      roughness.colorSpace = THREE.NoColorSpace
      for (const texture of [base, normal, roughness]) {
        texture.wrapS = texture.wrapT = THREE.RepeatWrapping
        texture.anisotropy = profile.worldAnisotropy
        texture.needsUpdate = true
      }
    })
  }, [profile.worldAnisotropy, textureMap])
  const materials = useMemo(() => createMaterials(textureMap), [textureMap])
  const merged = useMemo(() => buildMergedRoom(items, scenes), [items, scenes])

  useEffect(() => { onLoaded?.(assetIds.length) }, [assetIds, onLoaded])
  useEffect(() => () => merged.forEach(entry => entry.geometry.dispose()), [merged])
  useEffect(() => () => materials.forEach(material => material.dispose()), [materials])

  return <group name="resident-merged-room-assets">
    {merged.map(({ materialId, geometry }) => <mesh
      key={materialId}
      geometry={geometry}
      material={materials.get(materialId)}
      castShadow={profile.shadows && !['cabinet_glass', 'clear_acrylic'].includes(materialId)}
      receiveShadow
      frustumCulled={false}
    />)}
  </group>
}

export function furnitureUrl(version, assetId) {
  const file = FURNITURE_FILE[assetId] || assetId
  if (AUTHORED_FURNITURE.has(assetId) || AUTHORED_FURNITURE.has(file)) return `/tcg-room/furniture/${file}.glb?v=3`
  return `/api/tcg-room/module/assets/${encodeURIComponent(version)}/assets/${assetId}.glb`
}

export function AuthoredFurnitureItems({ version, items, quality = 'medium' }) {
  return <group name="authored-shop-furniture">
    {items.map(item => <AuthoredFurniturePiece key={item.key} version={version} item={item} quality={quality} />)}
  </group>
}

function AuthoredFurniturePiece({ version, item, quality }) {
  const { scene } = useGLTF(furnitureUrl(version, item.assetId))
  const profile = roomQualityProfile(quality)
  const clone = useMemo(() => {
    const value = scene.clone(true)
    value.traverse(node => {
      if (!node.isMesh) return
      const glass = /glass|acrylic/i.test(node.material?.name || '')
      node.castShadow = profile.shadows && !glass
      node.receiveShadow = true
      node.userData.placeSurface = SURFACE_HOST_ASSETS.has(item.assetId)
    })
    return value
  }, [item.assetId, profile.shadows, scene])
  const p = item.position
  const r = item.rotation
  const scale = item.scale || standMeshScale(item.assetId)
  return <group position={p} rotation={r} scale={scale}>
    <primitive object={clone} />
  </group>
}

const BOOSTER_WRAPPERS = Object.freeze({
  permanent: '/tcg-booster-permanent-cutout.png',
  release_standard: '/tcg-booster-standard-cutout.png',
  release_premium: '/tcg-booster-premium-cutout.png',
  limited: '/tcg-booster-limited-cutout.png',
  weekly_protection: '/tcg-booster-limited-cutout.png',
})

function boosterWrapper(product = {}) {
  if (product.wrapper_src) return product.wrapper_src
  return BOOSTER_WRAPPERS[product.product_kind] || BOOSTER_WRAPPERS.permanent
}

// The order payload freezes this at purchase time.  Keep the older field
// spellings as fallbacks so packs purchased before snapshot_art_url was added
// can still show a real Vault image instead of exposing the wrapper's black
// artwork window.
function boosterSnapshotArt(product = {}, packIndex = 0) {
  const frozen = Array.isArray(product.snapshot_art_urls) ? product.snapshot_art_urls.filter(Boolean) : []
  if (frozen.length) {
    const productOffset = Number(product.id || 0) || 0
    return frozen[(productOffset + packIndex) % frozen.length]
  }
  if (product.snapshot_art_url) return product.snapshot_art_url
  if (product.snapshot_art_image_id) return `/api/images/${Number(product.snapshot_art_image_id)}/file`
  return product.art_url || product.image_url || product.cover_image_url || null
}

/** Render the same real Vault wrapper art used by the shop, never the gray mesh fallback. */
export function DeliveredPacks({ parcel }) {
  const deliveries = Array.isArray(parcel) ? parcel : (parcel ? [parcel] : [])
  const packs = useMemo(() => deliveries.flatMap(delivery => {
    let deliveryPackIndex = 0
    return (delivery.contents || []).flatMap(line => Array.from(
      { length: Math.max(1, Number(line.quantity || 1)) },
      () => {
        const product = line.product || {}
        const packIndex = deliveryPackIndex++
        return { product, wrapper: boosterWrapper(product), art: boosterSnapshotArt(product, packIndex), deliveryId: delivery.id }
      },
    ))
  }), [deliveries])
  const textureUrls = useMemo(() => [...new Set([
    ...Object.values(BOOSTER_WRAPPERS),
    ...packs.map(pack => pack.art).filter(Boolean),
  ])], [packs])
  const textures = useTexture(textureUrls)
  const textureMap = useMemo(() => new Map(textureUrls.map((url, index) => [url, textures[index]])), [textureUrls, textures])
  const origin = BLUE_BOXES.inbox.position
  if (!deliveries.length || !packs.length) return null
  return <group name="sealed-booster-packs">
    {packs.map((pack, index) => {
      // These are loose sealed wrappers in the bottom of the inbox, not
      // freestanding products.  Keep the footprint conservative so every
      // wrapper remains inside the bin even at the most extreme rotation.
      const width = .20
      const height = .31
      // Keep the pile around the centre of the inbox.  The bin's usable
      // interior is intentionally much larger than this footprint; avoiding
      // the rounded side walls is more important than spreading the pile out.
      const originX = origin[0] + [-.06, .03, .07, -.03, .05, -.01][index]
      const originZ = origin[2] + [-.04, .04, -.01, .05, -.04, .02][index]
      const floorY = origin[1] - .015 + index * .004
      const yaw = [-.18, .31, -.42, .16, .48, -.27][index]
      const map = textureMap.get(pack.wrapper) || textures[0]
      const artMap = pack.art ? textureMap.get(pack.art) : null
      return <group
        key={`${pack.deliveryId}-${pack.product.code || pack.product.id || 'pack'}-${index}`}
        position={[originX, floorY, originZ]}
        // PlaneGeometry is XY.  Rotate X once to lay it on the XZ floor, then
        // apply yaw around its now-upward normal (the Z Euler slot).  Putting
        // yaw in the Y slot would tilt the wrapper back toward vertical.
        rotation={[-Math.PI / 2, 0, yaw]}
      >
        {/* A transparent wrapper plane has no artificial block, border, or
            black backing.  The purchased wrapper/snapshot artwork is already
            frozen in the product payload and is what we display here. */}
        <mesh castShadow receiveShadow>
          <planeGeometry args={[width, height]} />
          <meshBasicMaterial map={map} transparent alphaTest={.08} side={THREE.DoubleSide} toneMapped={false} />
        </mesh>
        {artMap && <mesh position={[0, 0, 0.001]} castShadow>
          <planeGeometry args={[width * .58, height * .64]} />
          <meshBasicMaterial map={artMap} transparent alphaTest={.02} side={THREE.DoubleSide} toneMapped={false} />
        </mesh>}
    </group>
    })}
  </group>
}

export function PlacementGhost({ version, preview }) {
  const url = furnitureUrl(version, preview.assetId)
  const { scene } = useGLTF(url, true)
  const ghost = useMemo(() => {
    const value = scene.clone(true)
    value.traverse(node => {
      if (!node.isMesh || node.name.startsWith('UCX_')) { if (node.name?.startsWith('UCX_')) node.visible = false; return }
      node.material = new THREE.MeshBasicMaterial({ color: preview.valid ? '#38dc75' : '#ff4d62', transparent: true, opacity: .48, depthWrite: false })
      node.renderOrder = 20
    })
    return value
  }, [preview.valid, scene])
  useEffect(() => () => ghost.traverse(node => node.isMesh && node.material?.dispose()), [ghost])
  const p = preview.transform.position
  const r = preview.transform.rotation
  const color = preview.valid ? '#38dc75' : '#ff4d62'
  const footprint = preview.definition?.footprint || { width: .5, depth: .5 }
  const width = Math.max(.35, footprint.width || .5)
  const depth = Math.max(.35, footprint.depth || .5)
  const scale = standMeshScale(preview.assetId)
  return <group position={[p.x, p.y, p.z]} rotation={[r.x, r.y, r.z]} scale={scale}>
    <primitive object={ghost} frustumCulled={false} />
    {preview.definition?.placement_kind === 'floor' && <>
      <mesh position={[0, .018, 0]} renderOrder={21}>
        <boxGeometry args={[width, .028, depth]} />
        <meshBasicMaterial color={color} transparent opacity={.22} depthWrite={false} depthTest={false} />
      </mesh>
      <mesh position={[0, .038, 0]} renderOrder={22}>
        <boxGeometry args={[width, .035, depth]} />
        <meshBasicMaterial color={color} wireframe depthTest={false} />
      </mesh>
      <mesh position={[0, .055, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={23}>
        <ringGeometry args={[Math.max(.16, Math.min(width, depth) * .3), Math.max(.22, Math.min(width, depth) * .3 + .07), 32]} />
        <meshBasicMaterial color={color} transparent opacity={.95} side={THREE.DoubleSide} depthTest={false} />
      </mesh>
    </>}
  </group>
}

// Compatibility exports for older focused tests. Runtime uses MergedRoomAssets.
export default function RoomAsset() { return null }
export function InstancedRoomAsset() { return null }

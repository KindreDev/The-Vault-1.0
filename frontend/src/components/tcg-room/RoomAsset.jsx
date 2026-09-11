import { useEffect, useMemo } from 'react'
import { useGLTF, useTexture } from '@react-three/drei'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import * as THREE from 'three'

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

function preparedGeometry(source, matrix) {
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
      const materialId = canonicalMaterial(node.material)
      const geometry = preparedGeometry(node.geometry, placement.clone().multiply(node.matrixWorld))
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
      normalScale: new THREE.Vector2(.34, .34),
      // The authored maps are intentionally deep; a small additive lift keeps
      // their grain visible in a friendly daylight room instead of crushing it.
      emissive: values.color,
      emissiveIntensity: ['wall_paint', 'bedding_fabric'].includes(id) ? .42 : ['dark_wood', 'black_metal'].includes(id) ? .28 : .2,
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
  const assetIds = useMemo(() => [...new Set(items.map(item => item.assetId))].sort(), [items])
  const urls = useMemo(() => assetIds.map(id => `/api/tcg-room/module/assets/${encodeURIComponent(version)}/assets/${id}.glb`), [assetIds, version])
  const loaded = useGLTF(urls, true)
  const materialUrls = useMemo(() => TEXTURED_MATERIALS.flatMap(id => ['base_color', 'normal'].map(kind =>
    `/api/tcg-room/module/assets/${encodeURIComponent(version)}/materials/${id}/${id}_${kind}.png`)), [version])
  const materialTextures = useTexture(materialUrls)
  const textureMap = useMemo(() => new Map(TEXTURED_MATERIALS.map((id, index) => [id, {
    base: materialTextures[index * 2], normal: materialTextures[index * 2 + 1],
  }])), [materialTextures])
  const scenes = useMemo(() => new Map(assetIds.map((id, index) => [id, loaded[index].scene])), [assetIds, loaded])
  useEffect(() => {
    textureMap.forEach(({ base, normal }) => {
      base.colorSpace = THREE.SRGBColorSpace
      normal.colorSpace = THREE.NoColorSpace
      for (const texture of [base, normal]) {
        texture.wrapS = texture.wrapT = THREE.RepeatWrapping
        texture.anisotropy = 2
        texture.needsUpdate = true
      }
    })
  }, [textureMap])
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
      castShadow={quality === 'high' && !['cabinet_glass', 'clear_acrylic'].includes(materialId)}
      receiveShadow
      frustumCulled={false}
    />)}
  </group>
}

export function PlacementGhost({ version, preview }) {
  const url = `/api/tcg-room/module/assets/${encodeURIComponent(version)}/assets/${preview.assetId}.glb`
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
  return <group position={[p.x, p.y, p.z]} rotation={[r.x, r.y, r.z]}>
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

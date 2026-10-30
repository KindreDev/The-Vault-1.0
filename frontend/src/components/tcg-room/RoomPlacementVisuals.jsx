import { useEffect, useMemo, useRef } from 'react'
import { useGLTF } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { POSTER_ASSETS, POSTER_FRAMES, SURFACE_ASSETS, furnitureModelYawOffset, standMeshScale } from './roomLayout'
import { usePosterTexture } from './RoomPosterDisplays'
import { furnitureUrl } from './RoomAsset'
import { GLASS_PATTERN, cheapGlass } from './roomMaterials'

function footprintTexture() {
  // A tiled build-mode footprint: soft fill with a bright cell border.
  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const context = canvas.getContext('2d')
  context.fillStyle = 'rgba(255,255,255,.18)'
  context.fillRect(0, 0, size, size)
  context.strokeStyle = 'rgba(255,255,255,.55)'
  context.lineWidth = 3
  context.strokeRect(1.5, 1.5, size - 3, size - 3)
  const texture = new THREE.CanvasTexture(canvas)
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

const GHOST_VALID = new THREE.Color('#6ff0a2')
const GHOST_INVALID = new THREE.Color('#ff4d62')

/**
 * The carried item in placement mode.  It renders with its real materials,
 * glides toward the cursor and hovers slightly while carried.  Invalid spots
 * tint it red; a silhouette shows the parts hidden behind walls.
 */
export function PlacementGhost({ version, preview }) {
  const url = furnitureUrl(version, preview.assetId)
  const { scene } = useGLTF(url, true)
  const group = useRef(null)
  const initialised = useRef(false)
  const targetPosition = useMemo(() => new THREE.Vector3(), [])
  const targetQuaternion = useMemo(() => new THREE.Quaternion(), [])
  const euler = useMemo(() => new THREE.Euler(), [])
  const { solid, xray, materials, xrayMaterial } = useMemo(() => {
    const materials = []
    // GreaterDepth: the silhouette only draws where something hides the item.
    const xrayMaterial = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: .28, depthWrite: false, depthFunc: THREE.GreaterDepth })
    const solid = scene.clone(true)
    const xray = scene.clone(true)
    solid.traverse(node => {
      if (!node.isMesh) return
      if (node.name.startsWith('UCX_')) { node.visible = false; return }
      const sources = Array.isArray(node.material) ? node.material : [node.material]
      const clones = sources.map(source => {
        const material = source.clone()
        if (GLASS_PATTERN.test(`${node.name || ''} ${source.name || ''}`)) cheapGlass(material, .2)
        else { material.transparent = true; material.opacity = .9 }
        if (material.emissive) material.emissive.set('#000000')
        materials.push(material)
        return material
      })
      node.material = Array.isArray(node.material) ? clones : clones[0]
      node.castShadow = false
      node.receiveShadow = false
      node.frustumCulled = false
    })
    xray.traverse(node => {
      if (!node.isMesh) return
      if (node.name.startsWith('UCX_')) { node.visible = false; return }
      node.material = xrayMaterial
      // Drawn before the ghost itself, so it only tests against the room.
      node.renderOrder = -1
      node.frustumCulled = false
    })
    return { solid, xray, materials, xrayMaterial }
  }, [scene])
  const footprintMap = useMemo(footprintTexture, [])
  useEffect(() => () => { materials.forEach(material => material.dispose()); xrayMaterial.dispose() }, [materials, xrayMaterial])
  useEffect(() => () => footprintMap.dispose(), [footprintMap])
  const p = preview.transform.position
  const r = preview.transform.rotation
  const floorItem = preview.definition?.placement_kind === 'floor' && !SURFACE_ASSETS.has(preview.assetId)
  const footprint = preview.definition?.footprint || { width: .5, depth: .5 }
  const width = Math.max(.25, footprint.width || .5)
  const depth = Math.max(.25, footprint.depth || .5)
  const scale = standMeshScale(preview.assetId)
  useEffect(() => {
    footprintMap.repeat.set(Math.max(1, Math.round(width / .25)), Math.max(1, Math.round(depth / .25)))
    footprintMap.needsUpdate = true
  }, [depth, footprintMap, width])
  useFrame((state, delta) => {
    const node = group.current
    if (!node) return
    const carried = !preview.locked && floorItem
    targetPosition.set(p.x, p.y + (carried ? .05 + Math.sin(state.clock.elapsedTime * 3.2) * .012 : 0), p.z)
    targetQuaternion.setFromEuler(euler.set(r.x, r.y + furnitureModelYawOffset(preview.assetId), r.z))
    if (!initialised.current) {
      node.position.copy(targetPosition)
      node.quaternion.copy(targetQuaternion)
      initialised.current = true
    } else {
      node.position.lerp(targetPosition, 1 - Math.exp(-20 * Math.min(delta, .1)))
      node.quaternion.slerp(targetQuaternion, 1 - Math.exp(-16 * Math.min(delta, .1)))
    }
    const tint = preview.valid ? GHOST_VALID : GHOST_INVALID
    xrayMaterial.color.copy(tint)
    for (const material of materials) {
      if (material.emissive) material.emissive.copy(tint).multiplyScalar(preview.valid ? 0 : .55)
    }
  })
  const color = preview.valid ? '#6ff0a2' : '#ff4d62'
  return <group>
    <group ref={group} scale={scale}>
      <primitive object={solid} />
      <primitive object={xray} />
      {POSTER_ASSETS.has(preview.assetId) && preview.transform?.content?.image_id && <PlacementPosterPrint assetId={preview.assetId} content={preview.transform.content} />}
    </group>
    {floorItem && <mesh position={[p.x, p.y + .012, p.z]} rotation={[-Math.PI / 2, 0, r.y]} renderOrder={19}>
      <planeGeometry args={[width, depth]} />
      <meshBasicMaterial map={footprintMap} color={color} transparent opacity={.85} depthWrite={false} toneMapped={false} polygonOffset polygonOffsetFactor={-2} />
    </mesh>}
  </group>
}

/** Sims-style build grid on the floor that fades out around the carried item. */
export function PlacementFloorGrid({ preview }) {
  const material = useMemo(() => new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, toneMapped: false,
    uniforms: { uCenter: { value: new THREE.Vector2() }, uColor: { value: new THREE.Color('#d9d2ff') }, uCell: { value: .25 } },
    vertexShader: /* glsl */`
      varying vec2 vWorld;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorld = world.xz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }`,
    fragmentShader: /* glsl */`
      uniform vec2 uCenter;
      uniform vec3 uColor;
      uniform float uCell;
      varying vec2 vWorld;
      void main() {
        vec2 grid = vWorld / uCell;
        vec2 cell = abs(fract(grid - .5) - .5) / fwidth(grid);
        float line = 1.0 - min(min(cell.x, cell.y), 1.0);
        float fade = 1.0 - smoothstep(.7, 2.4, distance(vWorld, uCenter));
        gl_FragColor = vec4(uColor, line * fade * .5);
      }`,
  }), [])
  useEffect(() => () => material.dispose(), [material])
  const p = preview?.transform?.position
  useFrame((state, delta) => {
    if (!p) return
    const center = material.uniforms.uCenter.value
    const glide = 1 - Math.exp(-14 * Math.min(delta, .1))
    center.x += (p.x - center.x) * glide
    center.y += (p.z - center.y) * glide
  })
  if (!p) return null
  return <mesh position={[-.5, .176, 0]} rotation={[-Math.PI / 2, 0, 0]} material={material} renderOrder={18} frustumCulled={false}>
    <planeGeometry args={[9, 10]} />
  </mesh>
}

function PlacementPosterPrint({ assetId, content }) {
  const frame = POSTER_FRAMES[assetId]
  const texture = usePosterTexture(content.image_id, frame, content.fit || frame.fit)
  if (!texture) return null
  return <mesh position={[0, frame.y, frame.z + .006]} renderOrder={24}>
    <planeGeometry args={[frame.width, frame.height]} />
    <meshBasicMaterial map={texture} transparent opacity={.86} toneMapped={false} side={THREE.DoubleSide} depthWrite={false} depthTest={false} />
  </mesh>
}

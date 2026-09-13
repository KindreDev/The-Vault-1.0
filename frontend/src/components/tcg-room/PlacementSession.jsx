import { useEffect, useMemo, useRef } from 'react'
import { Html } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { Check } from 'lucide-react'
import * as THREE from 'three'
import { AUTHORED_SURFACES, FLOOR_Y, PLACEMENT_BOUNDS, SURFACE_ASSETS, SURFACE_HOST_ASSETS } from './roomLayout'

function ownedSurfaces(bootstrap) {
  const definitions = new Map((bootstrap?.catalog || []).map(item => [item.id, item]))
  return (bootstrap?.room?.placements || []).flatMap(row => {
    const instance = bootstrap.owned_instances?.find(value => value.id === row.instance_id)
    const definition = definitions.get(instance?.definition_id)
    if (!definition || !SURFACE_HOST_ASSETS.has(definition.asset_id)) return []
    const footprint = definition.footprint || { width: .5, depth: .5, height: .5 }
    const p = row.transform?.position || {}
    const yaw = row.transform?.rotation?.y || 0
    const cosine = Math.abs(Math.cos(yaw)), sine = Math.abs(Math.sin(yaw))
    const width = cosine * (footprint.width || .5) + sine * (footprint.depth || .5)
    const depth = sine * (footprint.width || .5) + cosine * (footprint.depth || .5)
    return [{
      id: `owned-${row.instance_id}`,
      minX: (p.x || 0) - width / 2, maxX: (p.x || 0) + width / 2,
      minZ: (p.z || 0) - depth / 2, maxZ: (p.z || 0) + depth / 2,
      top: (p.y || 0) + (footprint.height || .5),
    }]
  })
}

function hitSurface(x, z, hosts) {
  return hosts.find(host => x >= host.minX && x <= host.maxX && z >= host.minZ && z <= host.maxZ) || null
}

function wallSnap(x, z, y) {
  const bounds = PLACEMENT_BOUNDS.floor
  const distances = [
    { plane: 'north', x, z: bounds.minZ, yaw: 0, dist: Math.abs(z - bounds.minZ) },
    { plane: 'south', x, z: bounds.maxZ, yaw: Math.PI, dist: Math.abs(z - bounds.maxZ) },
    { plane: 'east', x: bounds.maxX, z, yaw: -Math.PI / 2, dist: Math.abs(x - bounds.maxX) },
    { plane: 'west', x: bounds.minX, z, yaw: Math.PI / 2, dist: Math.abs(x - bounds.minX) },
  ]
  const best = distances.sort((a, b) => a.dist - b.dist)[0]
  return { x: best.x, y: THREE.MathUtils.clamp(y, PLACEMENT_BOUNDS.wallY.min, PLACEMENT_BOUNDS.wallY.max), z: best.z, yaw: best.yaw, support: 'wall' }
}

export default function PlacementSession({ arranging, bootstrap, preview, followMouse = true, onHover, onPlace, onRotate, onConfirm, onSelectInstance }) {
  const { camera, raycaster, pointer } = useThree()
  const drag = useRef(null)
  const lastHover = useRef('')
  const plane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), -FLOOR_Y), [])
  const scratch = useMemo(() => new THREE.Vector3(), [])
  const hosts = useMemo(() => [...AUTHORED_SURFACES, ...ownedSurfaces(bootstrap)], [bootstrap])
  const definition = preview?.definition
  const needsSurface = SURFACE_ASSETS.has(definition?.asset_id)
  const wallItem = definition?.placement_kind === 'wall'
  const placed = bootstrap?.room?.placements || []
  const definitions = useMemo(() => new Map((bootstrap?.catalog || []).map(item => [item.id, item])), [bootstrap])

  useEffect(() => {
    if (!arranging) return undefined
    const move = event => {
      if (!drag.current || event.buttons !== 1) return
      const delta = (event.movementX + event.movementY) * .01
      onRotate?.(drag.current.yaw + delta)
      drag.current.yaw += delta
    }
    const up = () => { drag.current = null }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
  }, [arranging, onRotate])

  useFrame(() => {
    if (!arranging || !definition || drag.current || !followMouse) return
    raycaster.setFromCamera(pointer, camera)
    const ok = raycaster.ray.intersectPlane(plane, scratch)
    if (!ok) return
    const yaw = preview?.transform?.rotation?.y || 0
    const sample = wallItem
      ? wallSnap(scratch.x, scratch.z, camera.position.y - .2)
      : (() => {
        const host = hitSurface(scratch.x, scratch.z, hosts)
        if (needsSurface) return host
          ? { x: scratch.x, y: host.top, z: scratch.z, yaw, support: 'surface' }
          : { x: scratch.x, y: 0, z: scratch.z, yaw, support: 'invalid' }
        return { x: scratch.x, y: FLOOR_Y, z: scratch.z, yaw, support: host ? 'surface' : 'floor' }
      })()
    const key = `${sample.x.toFixed(2)}:${sample.z.toFixed(2)}:${sample.y.toFixed(2)}:${sample.support}`
    if (key === lastHover.current) return
    lastHover.current = key
    onHover?.(sample)
  })

  const onCanvasClick = event => {
    if (!arranging || !definition || event.button !== 0) return
    if (event.intersections?.some(hit => hit.object.userData.placementGizmo)) return
    raycaster.setFromCamera(pointer, camera)
    if (!raycaster.ray.intersectPlane(plane, scratch)) return
    if (wallItem) { onPlace?.(wallSnap(scratch.x, scratch.z, camera.position.y - .2)); return }
    const host = hitSurface(scratch.x, scratch.z, hosts)
    if (needsSurface && !host) return
    onPlace?.({
      x: scratch.x,
      y: needsSurface ? host.top : FLOOR_Y,
      z: scratch.z,
      yaw: preview?.transform?.rotation?.y || 0,
      support: needsSurface ? 'surface' : 'floor',
    })
  }

  const p = preview?.transform?.position
  const yaw = preview?.transform?.rotation?.y || 0
  const height = Math.max(.35, definition?.footprint?.height || .45)

  return <group>
    {arranging && <mesh visible={false} onClick={onCanvasClick} position={[-.5, FLOOR_Y, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[24, 24]} />
      <meshBasicMaterial transparent opacity={0} />
    </mesh>}
    {arranging && placed.map(row => {
      const instance = bootstrap.owned_instances?.find(value => value.id === row.instance_id)
      const def = definitions.get(instance?.definition_id)
      if (!def || row.instance_id === preview?.instanceId) return null
      const pos = row.transform?.position || {}
      const footprint = def.footprint || { width: .5, depth: .5, height: .5 }
      return <mesh key={row.instance_id} position={[pos.x || 0, (pos.y || 0) + (footprint.height || .5) / 2, pos.z || 0]} userData={{ instanceId: row.instance_id }}
        onClick={event => { event.stopPropagation(); onSelectInstance?.(row.instance_id) }}>
        <boxGeometry args={[footprint.width || .5, footprint.height || .5, footprint.depth || .5]} />
        <meshBasicMaterial transparent opacity={0} />
      </mesh>
    })}
    {arranging && preview && p && <>
      <group position={[p.x, p.y, p.z]} rotation={[0, yaw, 0]}>
        <mesh position={[0, .04, 0]} rotation={[-Math.PI / 2, 0, 0]} userData={{ placementGizmo: 'yaw' }}
          onPointerDown={event => { event.stopPropagation(); drag.current = { yaw } }}>
          <ringGeometry args={[.42, .52, 48]} />
          <meshBasicMaterial color="#3ddc84" transparent opacity={.9} side={THREE.DoubleSide} depthTest={false} />
        </mesh>
        <mesh position={[.55, .02, 0]} userData={{ placementGizmo: 'x' }}>
          <boxGeometry args={[.38, .02, .02]} /><meshBasicMaterial color="#ff5b5b" depthTest={false} />
        </mesh>
        <mesh position={[0, .55, 0]} userData={{ placementGizmo: 'y' }}>
          <boxGeometry args={[.02, .38, .02]} /><meshBasicMaterial color="#3ddc84" depthTest={false} />
        </mesh>
        <mesh position={[0, .02, .55]} userData={{ placementGizmo: 'z' }}>
          <boxGeometry args={[.02, .02, .38]} /><meshBasicMaterial color="#5b8cff" depthTest={false} />
        </mesh>
      </group>
      {preview.valid && <Html position={[p.x, p.y + height + .18, p.z]} center sprite occlude={false}>
        <button type="button" className="placement-check" onClick={event => { event.preventDefault(); event.stopPropagation(); onConfirm?.() }} aria-label="Confirm placement">
          <Check size={22} />
        </button>
      </Html>}
    </>}
  </group>
}

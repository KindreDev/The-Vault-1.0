import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { AUTHORED_FURNITURE, FLOOR_Y, PLACEMENT_BOUNDS, SURFACE_ASSETS } from './roomLayout'

export default function PlacementSession({ arranging, bootstrap, preview, onHover, onRotate, onLock, onSelectInstance, onDeselect }) {
  const { camera, raycaster, pointer, scene } = useThree()
  const lastHover = useRef('')
  const walls = useRef([])
  const surfaces = useRef([])
  const floors = useRef([])
  const normal = useMemo(() => new THREE.Vector3(), [])
  const definition = preview?.definition
  const needsSurface = SURFACE_ASSETS.has(definition?.asset_id)
  const wallItem = definition?.placement_kind === 'wall'
  const placed = bootstrap?.room?.placements || []
  const definitions = useMemo(() => new Map((bootstrap?.catalog || []).map(item => [item.id, item])), [bootstrap])
  const rightPointer = useRef(null)

  useEffect(() => {
    walls.current = []
    surfaces.current = []
    floors.current = []
  }, [arranging, bootstrap])

  useEffect(() => {
    if (!arranging) return undefined
    const key = event => {
      if (event.code !== 'KeyQ' && event.code !== 'KeyE') return
      const yaw = (preview?.transform?.rotation?.y || 0) + (event.code === 'KeyE' ? .12 : -.12)
      onRotate?.(yaw)
    }
    const wheel = event => {
      if (!arranging) return
      if (event.target?.closest?.('.placement-mode, .placement-context-hud')) return
      event.preventDefault()
      onRotate?.((preview?.transform?.rotation?.y || 0) + event.deltaY * .002)
    }
    const click = event => {
      if (event.button !== 0) return
      if (event.target?.closest?.('button, a, input, select, textarea, .placement-mode')) return
      if (!preview?.valid || preview.locked) return
      onLock?.()
    }
    window.addEventListener('keydown', key)
    window.addEventListener('wheel', wheel, { passive: false })
    window.addEventListener('pointerdown', click)
    const rightDown = event => {
      if (event.button !== 2 || event.target?.closest?.('button, a, input, select, textarea, .placement-mode')) return
      rightPointer.current = { x: event.clientX, y: event.clientY, moved: false }
    }
    const rightMove = event => {
      const start = rightPointer.current
      if (!start) return
      if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 8) start.moved = true
    }
    const rightUp = event => {
      if (event.type !== 'pointercancel' && event.button !== 2) return
      const start = rightPointer.current
      rightPointer.current = null
      if (start && !start.moved && !event.target?.closest?.('button, a, input, select, textarea, .placement-mode')) {
        onDeselect?.()
      }
    }
    const contextMenu = event => { if (arranging) event.preventDefault() }
    window.addEventListener('pointerdown', rightDown)
    window.addEventListener('pointermove', rightMove)
    window.addEventListener('pointerup', rightUp)
    window.addEventListener('pointercancel', rightUp)
    window.addEventListener('contextmenu', contextMenu)
    return () => {
      window.removeEventListener('keydown', key)
      window.removeEventListener('wheel', wheel)
      window.removeEventListener('pointerdown', click)
      window.removeEventListener('pointerdown', rightDown)
      window.removeEventListener('pointermove', rightMove)
      window.removeEventListener('pointerup', rightUp)
      window.removeEventListener('pointercancel', rightUp)
      window.removeEventListener('contextmenu', contextMenu)
      rightPointer.current = null
    }
  }, [arranging, onDeselect, onLock, onRotate, preview])

  useFrame(() => {
    if (!arranging || !definition) return
    if (!walls.current.length && !surfaces.current.length) {
      scene.traverse(node => {
        if (!node.isMesh) return
        if (node.userData.placeSurface) surfaces.current.push(node)
        if (node.userData.collide && /room/i.test(node.name) && !/floor/i.test(node.name)) walls.current.push(node)
        if (node.userData.collide && /floor/i.test(node.name)) floors.current.push(node)
      })
    }
    raycaster.setFromCamera(pointer, camera)
    const yaw = preview?.transform?.rotation?.y || 0
    let sample = null
    if (wallItem && walls.current.length) {
      const hit = raycaster.intersectObjects(walls.current, false).find(entry => {
        normal.copy(entry.face.normal).transformDirection(entry.object.matrixWorld)
        return Math.abs(normal.y) < .5
      })
      if (hit) {
        normal.copy(hit.face.normal).transformDirection(hit.object.matrixWorld)
        normal.y = 0
        if (normal.lengthSq() > .0001) normal.normalize()
        const height = definition.footprint?.height || 1
        const depth = Math.max(.08, definition.footprint?.depth || .12)
        const bottomOrigin = AUTHORED_FURNITURE.has(definition.asset_id)
        const y = bottomOrigin
          ? hit.point.y - height * .45
          : hit.point.y
        sample = {
          x: hit.point.x + normal.x * (depth / 2 + .02),
          y: THREE.MathUtils.clamp(y, PLACEMENT_BOUNDS.wallY.min, PLACEMENT_BOUNDS.wallY.max),
          z: hit.point.z + normal.z * (depth / 2 + .02),
          yaw: Math.atan2(normal.x, normal.z),
          support: 'wall',
        }
      }
    } else if (needsSurface) {
      const hit = raycaster.intersectObjects(surfaces.current, true).find(entry => {
        normal.copy(entry.face.normal).transformDirection(entry.object.matrixWorld)
        return normal.y > .55
      })
      sample = hit
        ? { x: hit.point.x, y: hit.point.y, z: hit.point.z, yaw, support: 'surface' }
        : { x: 0, y: FLOOR_Y, z: 0, yaw, support: 'invalid' }
    } else {
      const hit = raycaster.intersectObjects(floors.current, false)[0]
      sample = hit
        ? { x: hit.point.x, y: FLOOR_Y, z: hit.point.z, yaw, support: 'floor' }
        : null
    }
    if (!sample) return
    const key = `${sample.x.toFixed(3)}:${sample.y.toFixed(3)}:${sample.z.toFixed(3)}:${sample.yaw.toFixed(3)}:${sample.support}`
    if (key === lastHover.current) return
    lastHover.current = key
    onHover?.(sample)
  })

  return <group>
    {arranging && !preview && placed.map(row => {
      const instance = bootstrap.owned_instances?.find(value => value.id === row.instance_id)
      const def = definitions.get(instance?.definition_id)
      if (!def) return null
      const pos = row.transform?.position || {}
      const footprint = def.footprint || { width: .5, depth: .5, height: .5 }
      return <mesh key={row.instance_id} position={[pos.x || 0, (pos.y || 0) + (footprint.height || .5) / 2, pos.z || 0]} userData={{ instanceId: row.instance_id }}
        onPointerDown={event => {
          event.stopPropagation()
          if (event.button !== 0) return
          onSelectInstance?.(row.instance_id)
        }}>
        <boxGeometry args={[footprint.width || .5, footprint.height || .5, footprint.depth || .5]} />
        {/* Keep the hitbox raycastable without allowing its invisible volume to
            write depth or color over the furniture meshes while placement mode is open. */}
        <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
      </mesh>
    })}
  </group>
}

import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Edges } from '@react-three/drei'
import * as THREE from 'three'
import { AUTHORED_FURNITURE, FLOOR_Y, PLACEMENT_BOUNDS, SURFACE_ASSETS, WALL_BASE_ORIGIN_ASSETS } from './roomLayout'
import { snapFloorPoint, snapWallPoint, stepRotation } from './roomPlacementRules'

const UI_TARGETS = 'button, a, input, select, textarea, .placement-mode, .placement-context-hud'
const WHEEL_NOTCH = 100

export default function PlacementSession({ arranging, bootstrap, preview, onHover, onRotate, onLock, onSelectInstance, onDeselect }) {
  const { camera, raycaster, pointer, scene, gl } = useThree()
  const lastHover = useRef('')
  const lastCast = useRef('')
  const walls = useRef([])
  const surfaces = useRef([])
  const floors = useRef([])
  const freeMove = useRef(false)
  const wheelTravel = useRef(0)
  const [hovered, setHovered] = useState(null)
  const normal = useMemo(() => new THREE.Vector3(), [])
  const definition = preview?.definition
  const needsSurface = SURFACE_ASSETS.has(definition?.asset_id)
  const wallItem = definition?.placement_kind === 'wall'
  const placed = bootstrap?.room?.placements || []
  const definitions = useMemo(() => new Map((bootstrap?.catalog || []).map(item => [item.id, item])), [bootstrap])
  const rightPointer = useRef(null)
  const previewRef = useRef(preview)
  previewRef.current = preview

  useEffect(() => {
    walls.current = []
    surfaces.current = []
    floors.current = []
    lastCast.current = ''
  }, [arranging, bootstrap])

  useEffect(() => { if (!arranging || preview) setHovered(null) }, [arranging, preview])
  useEffect(() => {
    gl.domElement.style.cursor = arranging && hovered && !preview ? 'pointer' : ''
    return () => { gl.domElement.style.cursor = '' }
  }, [arranging, gl, hovered, preview])

  useEffect(() => {
    if (!arranging) return undefined
    const currentYaw = () => previewRef.current?.transform?.rotation?.y || 0
    const key = event => {
      if (event.key === 'Alt') { event.preventDefault(); freeMove.current = true; lastCast.current = '' }
      if (event.code !== 'KeyQ' && event.code !== 'KeyE') return
      if (!previewRef.current || previewRef.current.definition?.placement_kind === 'wall') return
      onRotate?.(stepRotation(currentYaw(), event.code === 'KeyE' ? 1 : -1, event.altKey))
    }
    const keyUp = event => { if (event.key === 'Alt') { freeMove.current = false; lastCast.current = '' } }
    const wheel = event => {
      if (event.target?.closest?.(UI_TARGETS)) return
      event.preventDefault()
      if (!previewRef.current || previewRef.current.definition?.placement_kind === 'wall') return
      // Trackpads send many small deltas; rotate one step per full notch.
      wheelTravel.current += event.deltaY
      if (Math.abs(wheelTravel.current) < WHEEL_NOTCH) return
      const direction = Math.sign(wheelTravel.current)
      wheelTravel.current = 0
      onRotate?.(stepRotation(currentYaw(), direction, event.altKey))
    }
    const click = event => {
      if (event.button !== 0) return
      if (event.target?.closest?.(UI_TARGETS)) return
      const current = previewRef.current
      if (!current?.valid || current.locked) return
      onLock?.()
    }
    const rightDown = event => {
      if (event.button !== 2 || event.target?.closest?.(UI_TARGETS)) return
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
      if (start && !start.moved && !event.target?.closest?.(UI_TARGETS)) onDeselect?.()
    }
    const contextMenu = event => event.preventDefault()
    const blur = () => { freeMove.current = false }
    window.addEventListener('keydown', key)
    window.addEventListener('keyup', keyUp)
    window.addEventListener('blur', blur)
    window.addEventListener('wheel', wheel, { passive: false })
    window.addEventListener('pointerdown', click)
    window.addEventListener('pointerdown', rightDown)
    window.addEventListener('pointermove', rightMove)
    window.addEventListener('pointerup', rightUp)
    window.addEventListener('pointercancel', rightUp)
    window.addEventListener('contextmenu', contextMenu)
    return () => {
      window.removeEventListener('keydown', key)
      window.removeEventListener('keyup', keyUp)
      window.removeEventListener('blur', blur)
      window.removeEventListener('wheel', wheel)
      window.removeEventListener('pointerdown', click)
      window.removeEventListener('pointerdown', rightDown)
      window.removeEventListener('pointermove', rightMove)
      window.removeEventListener('pointerup', rightUp)
      window.removeEventListener('pointercancel', rightUp)
      window.removeEventListener('contextmenu', contextMenu)
      rightPointer.current = null
      freeMove.current = false
    }
  }, [arranging, onDeselect, onLock, onRotate])

  useFrame(() => {
    if (!arranging || !definition || preview?.locked) return
    if (!walls.current.length && !surfaces.current.length) {
      scene.traverse(node => {
        if (!node.isMesh) return
        if (node.userData.placeSurface) surfaces.current.push(node)
        if (node.userData.collide && /room/i.test(node.name) && !/floor/i.test(node.name)) walls.current.push(node)
        if (node.userData.collide && /floor/i.test(node.name)) floors.current.push(node)
      })
    }
    const yaw = preview?.transform?.rotation?.y || 0
    // Only raycast when the pointer, camera, rotation or snap mode changed.
    const castKey = `${pointer.x.toFixed(4)}:${pointer.y.toFixed(4)}:${camera.position.x.toFixed(3)}:${camera.position.z.toFixed(3)}:${camera.position.y.toFixed(3)}:${camera.rotation.x.toFixed(4)}:${camera.rotation.y.toFixed(4)}:${yaw}:${freeMove.current}:${preview?.gridSnap}:${definition.id}`
    if (castKey === lastCast.current) return
    lastCast.current = castKey
    const snapping = preview?.gridSnap !== false && !freeMove.current
    raycaster.setFromCamera(pointer, camera)
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
        const y = bottomOrigin ? hit.point.y - height * .45 : hit.point.y
        sample = {
          x: hit.point.x + normal.x * (depth / 2 + .02),
          y: THREE.MathUtils.clamp(y, PLACEMENT_BOUNDS.wallY.min, PLACEMENT_BOUNDS.wallY.max),
          z: hit.point.z + normal.z * (depth / 2 + .02),
          yaw: Math.atan2(normal.x, normal.z),
          support: 'wall',
        }
        if (snapping) sample = snapWallPoint(sample)
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
      if (hit) {
        const point = snapping ? snapFloorPoint(hit.point.x, hit.point.z, definition, yaw) : hit.point
        sample = { x: point.x, y: FLOOR_Y, z: point.z, yaw, support: 'floor' }
      }
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
      const height = footprint.height || .5
      const centred = def.placement_kind === 'wall' && !WALL_BASE_ORIGIN_ASSETS.has(def.asset_id)
      const active = hovered === row.instance_id
      return <mesh key={row.instance_id} position={[pos.x || 0, (pos.y || 0) + (centred ? 0 : height / 2), pos.z || 0]} rotation={[0, row.transform?.rotation?.y || 0, 0]} userData={{ instanceId: row.instance_id }}
        onPointerOver={event => { event.stopPropagation(); setHovered(row.instance_id) }}
        onPointerOut={() => setHovered(current => current === row.instance_id ? null : current)}
        onPointerDown={event => {
          event.stopPropagation()
          if (event.button !== 0) return
          onSelectInstance?.(row.instance_id)
        }}>
        <boxGeometry args={[(footprint.width || .5) + .04, height + .04, (footprint.depth || .5) + .04]} />
        {/* Raycastable but invisible; only the hover outline is drawn. */}
        <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
        {active && <Edges color="#c9bcff" lineWidth={2} renderOrder={30} />}
      </mesh>
    })}
  </group>
}

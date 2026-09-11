import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { COLLISION_BOXES, INTERACTION_COPY, ROOM_SIZE } from './roomLayout'

const SPEED = 2.65
const isBlocked = (x, z) => Math.abs(x) > ROOM_SIZE.width / 2 - .32 || Math.abs(z) > ROOM_SIZE.depth / 2 - .32 || COLLISION_BOXES.some(box => x > box.min[0] && x < box.max[0] && z > box.min[1] && z < box.max[1])

function focusApproach(item, point, camera) {
  const kind = item.interactive
  if (kind === 'computer') return new THREE.Vector3(point.x, 1.34, point.z + 1.08)
  if (kind === 'door' || kind === 'mail') return new THREE.Vector3(-4.55, 1.62, point.z)
  if (kind === 'binder') return new THREE.Vector3(point.x, 1.62, -2.82)
  if (kind === 'parcel' || kind === 'parcel-place') return point.x < -4
    ? new THREE.Vector3(-4.12, 1.62, point.z)
    : new THREE.Vector3(point.x, 1.62, point.z - 1.28)
  if (kind === 'pile') return point.x < -4
    ? new THREE.Vector3(-3.82, 1.62, point.z)
    : new THREE.Vector3(point.x, 1.62, point.z - 1.25)
  if (['cabinet', 'display', 'poster'].includes(kind) && point.z > 2.8) return new THREE.Vector3(point.x, 1.62, point.z - 1.18)
  const offset = camera.position.clone().sub(point).setY(0)
  if (offset.lengthSq() < .01) offset.set(0, 0, 1)
  return point.clone().add(offset.normalize().multiplyScalar(1.08)).setY(1.62)
}

export default function FirstPersonController({ paused, focused, placementPreview, interactionItems, onNearby, onInteract, onMetrics }) {
  const { camera, gl } = useThree()
  const keys = useRef(new Set())
  const yaw = useRef(0)
  const pitch = useRef(0)
  const lastMetric = useRef(0)
  const lastNearby = useRef(null)
  const frameAverage = useRef(16.7)
  const target = useRef(new THREE.Vector3())
  const focusTween = useRef(null)

  useEffect(() => {
    camera.position.set(-1.1, 1.62, .15)
    camera.rotation.order = 'YXZ'
    camera.rotation.y = 0
  }, [camera])

  useEffect(() => {
    const down = event => {
      keys.current.add(event.code)
      if (event.code === 'KeyE') onInteract()
    }
    const up = event => keys.current.delete(event.code)
    const move = event => {
      if (document.pointerLockElement !== gl.domElement || paused || focused) return
      yaw.current -= event.movementX * .002
      pitch.current = THREE.MathUtils.clamp(pitch.current - event.movementY * .002, -1.25, 1.25)
    }
    const click = () => { if (!paused && !focused) gl.domElement.requestPointerLock?.() }
    window.addEventListener('keydown', down); window.addEventListener('keyup', up)
    document.addEventListener('mousemove', move); gl.domElement.addEventListener('click', click)
    return () => {
      window.removeEventListener('keydown', down); window.removeEventListener('keyup', up)
      document.removeEventListener('mousemove', move); gl.domElement.removeEventListener('click', click)
    }
  }, [focused, gl, onInteract, paused])

  useEffect(() => {
    if (!focused?.position) {
      yaw.current = camera.rotation.y
      pitch.current = camera.rotation.x
      focusTween.current = null
      return
    }
    const point = new THREE.Vector3(...focused.position)
    point.y = Math.max(1.05, Math.min(1.65, point.y || 1.25))
    focusTween.current = { start: camera.position.clone(), end: focusApproach(focused, point, camera), look: point, elapsed: 0 }
  }, [camera, focused])

  useEffect(() => {
    if (!placementPreview?.transform?.position) return
    const p = placementPreview.transform.position
    const targetPoint = new THREE.Vector3(p.x, Math.max(.7, p.y + .7), p.z)
    const wall = placementPreview.definition?.placement_kind === 'wall'
    const position = wall
      ? Math.abs(p.z) > Math.abs(p.x)
        ? new THREE.Vector3(p.x, 1.65, p.z - Math.sign(p.z) * 3)
        : new THREE.Vector3(p.x - Math.sign(p.x) * 3, 1.65, p.z)
      : new THREE.Vector3(THREE.MathUtils.clamp(p.x - 3, -5, 5), 2.35, THREE.MathUtils.clamp(p.z + 3.2, -5, 5))
    camera.position.copy(position)
    camera.lookAt(targetPoint)
    yaw.current = camera.rotation.y
    pitch.current = camera.rotation.x
  }, [camera, placementPreview?.instanceId])

  useFrame((state, delta) => {
    camera.rotation.set(pitch.current, yaw.current, 0)
    if (placementPreview?.transform?.position) {
      const p = placementPreview.transform.position
      camera.lookAt(p.x, Math.max(.7, p.y + .7), p.z)
      yaw.current = camera.rotation.y; pitch.current = camera.rotation.x
    }
    if (focusTween.current) {
      focusTween.current.elapsed += Math.min(delta, .05)
      const amount = 1 - Math.pow(1 - Math.min(1, focusTween.current.elapsed / .58), 3)
      camera.position.lerpVectors(focusTween.current.start, focusTween.current.end, amount)
      camera.lookAt(focusTween.current.look)
    }
    if (!paused && !focused) {
      const forward = Number(keys.current.has('KeyW')) - Number(keys.current.has('KeyS'))
      const side = Number(keys.current.has('KeyD')) - Number(keys.current.has('KeyA'))
      if (forward || side) {
        const direction = new THREE.Vector3(side, 0, -forward).normalize().applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw.current)
        const nextX = camera.position.x + direction.x * SPEED * delta
        const nextZ = camera.position.z + direction.z * SPEED * delta
        if (!isBlocked(nextX, camera.position.z)) camera.position.x = nextX
        if (!isBlocked(camera.position.x, nextZ)) camera.position.z = nextZ
      }
    }
    let best = null
    camera.getWorldDirection(target.current)
    interactionItems.forEach(item => {
      const point = new THREE.Vector3(...item.position); point.y = Math.max(point.y, 1.15)
      const offset = point.sub(camera.position); const distance = offset.length()
      const facing = distance ? target.current.dot(offset.normalize()) : 0
      if (distance < 2.25 && facing > .55 && (!best || facing / distance > best.score)) best = { ...item, score: facing / distance }
    })
    const nearbyKey = best?.key || null
    if (nearbyKey !== lastNearby.current) {
      lastNearby.current = nearbyKey
      onNearby(best ? { ...best, copy: INTERACTION_COPY[best.interactive] } : null)
    }
    if (delta < .25) frameAverage.current = frameAverage.current * .92 + delta * 1000 * .08
    if (state.clock.elapsedTime - lastMetric.current > .5) {
      lastMetric.current = state.clock.elapsedTime
      onMetrics({ frameMs: Math.round(frameAverage.current * 10) / 10, calls: gl.info.render.calls, triangles: gl.info.render.triangles, textures: gl.info.memory.textures, geometries: gl.info.memory.geometries })
    }
  })
  return null
}

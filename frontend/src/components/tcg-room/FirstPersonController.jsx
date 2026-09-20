import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { COLLISION_BOXES, EYE_HEIGHT, FLOOR_Y, INTERACTION_COPY, SAFE_SPAWN, WALK_BOUNDS } from './roomLayout'

const SPEED = 2.65
const CROUCH_EYE_HEIGHT = 1.05
const CEILING_EYE_HEIGHT = 2.62
const PLAYER_RADIUS = .28
const origin = new THREE.Vector3()
const heading = new THREE.Vector3()
const caster = new THREE.Raycaster()
const reticle = new THREE.Vector2(0, 0)

const inWalk = (x, z) => x >= WALK_BOUNDS.minX && x <= WALK_BOUNDS.maxX && z >= WALK_BOUNDS.minZ && z <= WALK_BOUNDS.maxZ
const inBoxes = (x, z) => COLLISION_BOXES.some(box => x > box.min[0] && x < box.max[0] && z > box.min[1] && z < box.max[1])
const isBlocked = (x, z) => !inWalk(x, z) || inBoxes(x, z)

function rayBlocked(from, toX, toZ, meshes) {
  const dx = toX - from.x
  const dz = toZ - from.z
  const dist = Math.hypot(dx, dz)
  if (dist < 1e-5 || !meshes.length) return false
  heading.set(dx, 0, dz).normalize()
  caster.near = .04
  caster.far = dist + PLAYER_RADIUS
  for (const y of [.48, 1.08]) {
    origin.set(from.x, y, from.z)
    caster.set(origin, heading)
    const hit = caster.intersectObjects(meshes, false).find(entry => entry.distance < dist + PLAYER_RADIUS)
    if (hit) return true
  }
  return false
}

function reticleCardKey(camera, scene) {
  // Interaction prompts for cards are driven by the rendered card geometry,
  // not the card's world-space anchor.  A small five-ray cross gives the
  // reticle a forgiving edge while still requiring a real, visible card hit.
  const rays = [[0, 0], [.045, 0], [-.045, 0], [0, .045], [0, -.045]]
  let nearest = null
  for (const [x, y] of rays) {
    reticle.set(x, y)
    caster.setFromCamera(reticle, camera)
    caster.near = camera.near
    caster.far = 2.8
    // Intersections are depth-sorted. Only the first visible geometry counts;
    // searching past a wall or another prop would make a hidden card prompt.
    const hit = caster.intersectObjects(scene.children, true)[0]
    if (!hit) continue
    let node = hit.object
    while (node && !node.userData?.interactionKey) node = node.parent
    if (node && (!nearest || hit.distance < nearest.distance)) nearest = { key: node.userData.interactionKey, distance: hit.distance }
  }
  return nearest
}

function safePose(position, yaw, pitch) {
  const next = position.clone()
  next.x = THREE.MathUtils.clamp(next.x, WALK_BOUNDS.minX, WALK_BOUNDS.maxX)
  next.z = THREE.MathUtils.clamp(next.z, WALK_BOUNDS.minZ, WALK_BOUNDS.maxZ)
  if (isBlocked(next.x, next.z)) next.set(SAFE_SPAWN.position[0], EYE_HEIGHT, SAFE_SPAWN.position[2])
  next.y = EYE_HEIGHT
  return { position: next, yaw, pitch: THREE.MathUtils.clamp(pitch, -1.1, 1.1) }
}

function walkableInFront(point, from) {
  const dx = from.x - point.x
  const dz = from.z - point.z
  const length = Math.hypot(dx, dz) || 1
  const toward = [dx / length, dz / length]
  const sides = [
    toward,
    [-toward[1], toward[0]],
    [toward[1], -toward[0]],
    [-toward[0], -toward[1]],
  ]
  for (const dist of [1.2, .95, 1.45, .7]) {
    for (const [nx, nz] of sides) {
      const x = point.x + nx * dist
      const z = point.z + nz * dist
      if (!isBlocked(x, z)) return new THREE.Vector3(x, EYE_HEIGHT, z)
    }
  }
  return new THREE.Vector3(SAFE_SPAWN.position[0], EYE_HEIGHT, SAFE_SPAWN.position[2])
}

function focusApproach(item, point, from) {
  const kind = item.interactive
  if (kind === 'computer') return walkableInFront(point, from || new THREE.Vector3(point.x + 1.2, EYE_HEIGHT, point.z))
  if (kind === 'door') return walkableInFront(point, from || new THREE.Vector3(point.x, EYE_HEIGHT, point.z - 1.2))
  if (kind === 'mail' || kind === 'parcel' || kind === 'parcel-place' || kind === 'pile') {
    return walkableInFront(point, from || new THREE.Vector3(point.x - 1.2, EYE_HEIGHT, point.z))
  }
  return walkableInFront(point, from || new THREE.Vector3(point.x, EYE_HEIGHT, point.z + 1.2))
}

export default function FirstPersonController({ paused, focused, arranging, interactionItems, onNearby, onInteract, onMetrics }) {
  const { camera, gl, scene } = useThree()
  const keys = useRef(new Set())
  const yaw = useRef(0)
  const pitch = useRef(0)
  const lastMetric = useRef(0)
  const lastNearby = useRef(null)
  const frameAverage = useRef(16.7)
  const target = useRef(new THREE.Vector3())
  const focusTween = useRef(null)
  const restorePose = useRef(null)
  const activeFocus = useRef(null)
  const lookHeld = useRef(false)
  const collideMeshes = useRef([])
  const collideReady = useRef(false)

  useEffect(() => {
    camera.position.set(...SAFE_SPAWN.position)
    camera.rotation.order = 'YXZ'
    yaw.current = SAFE_SPAWN.yaw
    pitch.current = SAFE_SPAWN.pitch
    camera.rotation.set(pitch.current, yaw.current, 0)
    restorePose.current = { position: camera.position.clone(), yaw: yaw.current, pitch: pitch.current }
  }, [camera])

  useEffect(() => {
    const down = event => {
      keys.current.add(event.code)
      if (event.code === 'KeyE' && !arranging) onInteract()
      if (event.code === 'MouseRight' || event.button === 2) lookHeld.current = true
    }
    const up = event => {
      keys.current.delete(event.code)
      if (event.button === 2) lookHeld.current = false
    }
    const move = event => {
      const looking = arranging ? lookHeld.current || event.buttons === 2 : document.pointerLockElement === gl.domElement
      if (!looking || paused || focused) return
      yaw.current -= event.movementX * .002
      pitch.current = THREE.MathUtils.clamp(pitch.current - event.movementY * .002, -1.25, 1.25)
    }
    const click = () => { if (!paused && !focused && !arranging) gl.domElement.requestPointerLock?.() }
    const blockMenu = event => { if (arranging) event.preventDefault() }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('mousedown', down)
    window.addEventListener('mouseup', up)
    document.addEventListener('mousemove', move)
    gl.domElement.addEventListener('click', click)
    gl.domElement.addEventListener('contextmenu', blockMenu)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('mousedown', down)
      window.removeEventListener('mouseup', up)
      document.removeEventListener('mousemove', move)
      gl.domElement.removeEventListener('click', click)
      gl.domElement.removeEventListener('contextmenu', blockMenu)
    }
  }, [arranging, focused, gl, onInteract, paused])

  useEffect(() => {
    if (!focused?.position) {
      keys.current.clear()
      focusTween.current = null
      if (activeFocus.current && restorePose.current) {
        const pose = safePose(restorePose.current.position, restorePose.current.yaw, restorePose.current.pitch)
        camera.position.copy(pose.position)
        camera.position.y = EYE_HEIGHT
        yaw.current = pose.yaw
        pitch.current = pose.pitch
        camera.rotation.set(pitch.current, yaw.current, 0)
      } else {
        camera.position.y = EYE_HEIGHT
        yaw.current = camera.rotation.y
        pitch.current = THREE.MathUtils.clamp(camera.rotation.x, -1.1, 1.1)
      }
      activeFocus.current = null
      return
    }
    if (!activeFocus.current) {
      keys.current.clear()
      restorePose.current = safePose(camera.position, yaw.current, pitch.current)
      activeFocus.current = focused.key || focused.interactive || true
    }
    const point = new THREE.Vector3(...focused.position)
    point.y = Math.max(1.05, Math.min(1.65, point.y || 1.25))
    const approach = safePose(focusApproach(focused, point, camera.position), yaw.current, pitch.current).position
    focusTween.current = { start: camera.position.clone(), end: approach, look: point, elapsed: 0 }
  }, [camera, focused])

  useEffect(() => {
    document.exitPointerLock?.()
    camera.position.y = EYE_HEIGHT
    pitch.current = THREE.MathUtils.clamp(pitch.current, -.85, .85)
    camera.rotation.set(pitch.current, yaw.current, 0)
  }, [arranging, camera])

  useFrame((state, delta) => {
    camera.rotation.set(pitch.current, yaw.current, 0)
    if (focusTween.current && focused) {
      focusTween.current.elapsed += Math.min(delta, .05)
      const amount = 1 - Math.pow(1 - Math.min(1, focusTween.current.elapsed / .58), 3)
      camera.position.lerpVectors(focusTween.current.start, focusTween.current.end, amount)
      camera.lookAt(focusTween.current.look)
      yaw.current = camera.rotation.y
      pitch.current = camera.rotation.x
    }
    if (!collideReady.current) {
      const found = []
      scene.traverse(node => { if (node.isMesh && node.userData.collide) found.push(node) })
      if (found.length) { collideMeshes.current = found; collideReady.current = true }
    }
    const canWalk = (!paused && !focused) || arranging
    if (canWalk) {
      const crouching = keys.current.has('KeyC')
      const rising = keys.current.has('Space')
      // Space raises the camera within the room; C lowers it into a crouch.
      // Both are bounded so the player cannot clip through the floor or roof.
      if (rising) camera.position.y = Math.min(CEILING_EYE_HEIGHT, camera.position.y + SPEED * delta)
      else if (crouching) camera.position.y = Math.max(FLOOR_Y + CROUCH_EYE_HEIGHT, camera.position.y - SPEED * delta)
      else if (camera.position.y < EYE_HEIGHT) camera.position.y = Math.min(EYE_HEIGHT, camera.position.y + SPEED * delta)
      const forward = Number(keys.current.has('KeyW')) - Number(keys.current.has('KeyS'))
      const side = Number(keys.current.has('KeyD')) - Number(keys.current.has('KeyA'))
      if (forward || side) {
        const direction = new THREE.Vector3(side, 0, -forward).normalize().applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw.current)
        const nextX = camera.position.x + direction.x * SPEED * delta
        const nextZ = camera.position.z + direction.z * SPEED * delta
        const walls = collideMeshes.current
        if (!isBlocked(nextX, camera.position.z) && !rayBlocked(camera.position, nextX, camera.position.z, walls)) camera.position.x = nextX
        if (!isBlocked(camera.position.x, nextZ) && !rayBlocked(camera.position, camera.position.x, nextZ, walls)) camera.position.z = nextZ
      }
    }
    let best = null
    if (!arranging) {
      camera.getWorldDirection(target.current)
      interactionItems.forEach(item => {
        if (item.interactive === 'card-inspect') {
          const hit = reticleCardKey(camera, scene)
          if (!hit || hit.key !== item.key) return
        }
        const point = new THREE.Vector3(...item.position)
        if (item.interactive !== 'card-inspect') point.y = Math.max(point.y, 1.15)
        const offset = point.sub(camera.position); const distance = offset.length()
        const facing = distance ? target.current.dot(offset.normalize()) : 0
        if (distance < 2.8 && facing > .42 && (!best || facing / distance > best.score)) best = { ...item, score: facing / distance }
      })
    }
    const nearbyKey = best?.key || null
    if (nearbyKey !== lastNearby.current) {
      lastNearby.current = nearbyKey
      onNearby(best ? { ...best, copy: best.copy || INTERACTION_COPY[best.interactive] } : null)
    }
    if (delta < .25) frameAverage.current = frameAverage.current * .92 + delta * 1000 * .08
    if (state.clock.elapsedTime - lastMetric.current > .5) {
      lastMetric.current = state.clock.elapsedTime
      onMetrics({ frameMs: Math.round(frameAverage.current * 10) / 10, calls: gl.info.render.calls, triangles: gl.info.render.triangles, textures: gl.info.memory.textures, geometries: gl.info.memory.geometries })
    }
  })
  return null
}

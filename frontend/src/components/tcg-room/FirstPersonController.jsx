import { useCallback, useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { EYE_HEIGHT, FLOOR_Y, INTERACTION_COPY, SAFE_SPAWN, WALK_BOUNDS } from './roomLayout'
import { isBlocked, isStandingFree, rayBlocked } from './roomCollision'

const WALK_SPEED = 2.65
const SPRINT_SPEED = 4.1
const ACCELERATION = 14
const DECELERATION = 11
const MOVEMENT_CODES = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'ShiftLeft', 'ShiftRight'])
// Right-click while walking steps through these zoom levels (1x, 2x, 4x).
const BASE_FOV = 66
const ZOOM_LEVELS = Object.freeze([1, 2, 4])
const ZOOM_RATE = 9
const CROUCH_EYE_HEIGHT = 1.05
const CEILING_EYE_HEIGHT = 2.62
const LOOK_SCALE = .0021
// Pointer lock occasionally reports a huge one-off movement (a known browser
// bug) which snaps the view.  Real flicks never come close to this.
const MAX_LOOK_STEP = 260
const INTERACT_RANGE = 2.8
const CARD_SCAN_INTERVAL = 3
const caster = new THREE.Raycaster()
const reticle = new THREE.Vector2(0, 0)
const scratchPoint = new THREE.Vector3()
const upAxis = new THREE.Vector3(0, 1, 0)
const moveDirection = new THREE.Vector3()
const RETICLE_RAYS = [[0, 0], [.045, 0], [-.045, 0], [0, .045], [0, -.045]]

function reticleCardKey(camera, candidates) {
  // Card prompts are driven by the rendered card geometry, not the card's
  // world anchor.  Rays only test the cards and the walls that could hide
  // them, never the whole merged room.
  let nearest = null
  for (const [x, y] of RETICLE_RAYS) {
    reticle.set(x, y)
    caster.setFromCamera(reticle, camera)
    caster.near = camera.near
    caster.far = INTERACT_RANGE
    const hit = caster.intersectObjects(candidates, true)[0]
    if (!hit) continue
    let node = hit.object
    while (node && !node.userData?.interactionKey) node = node.parent
    if (node && (!nearest || hit.distance < nearest.distance)) nearest = { key: node.userData.interactionKey, distance: hit.distance }
  }
  return nearest
}

const sightDirection = new THREE.Vector3()
// The target itself (a door, a framed poster on the wall) may sit inside the
// mesh it belongs to, so only hits clearly in front of it count as blocking.
function lineOfSightBlocked(from, to, meshes) {
  const distance = from.distanceTo(to)
  if (!meshes.length || distance < .35) return false
  caster.set(from, sightDirection.subVectors(to, from).normalize())
  caster.near = .05
  caster.far = distance - .3
  return caster.intersectObjects(meshes, false).length > 0
}

function safePose(position, yaw, pitch, obstacles) {
  const next = position.clone()
  next.x = THREE.MathUtils.clamp(next.x, WALK_BOUNDS.minX, WALK_BOUNDS.maxX)
  next.z = THREE.MathUtils.clamp(next.z, WALK_BOUNDS.minZ, WALK_BOUNDS.maxZ)
  if (!isStandingFree(next.x, next.z, obstacles)) next.set(SAFE_SPAWN.position[0], EYE_HEIGHT, SAFE_SPAWN.position[2])
  next.y = EYE_HEIGHT
  return { position: next, yaw, pitch: THREE.MathUtils.clamp(pitch, -1.1, 1.1) }
}

function walkableInFront(point, from, obstacles) {
  const dx = from.x - point.x
  const dz = from.z - point.z
  const length = Math.hypot(dx, dz) || 1
  const toward = [dx / length, dz / length]
  const sides = [toward, [-toward[1], toward[0]], [toward[1], -toward[0]], [-toward[0], -toward[1]]]
  for (const dist of [1.2, .95, 1.45, .7]) {
    for (const [nx, nz] of sides) {
      const x = point.x + nx * dist
      const z = point.z + nz * dist
      if (isStandingFree(x, z, obstacles)) return new THREE.Vector3(x, EYE_HEIGHT, z)
    }
  }
  return new THREE.Vector3(SAFE_SPAWN.position[0], EYE_HEIGHT, SAFE_SPAWN.position[2])
}

function focusApproach(item, point, from, obstacles) {
  const kind = item.interactive
  if (kind === 'computer') return walkableInFront(point, from || new THREE.Vector3(point.x + 1.2, EYE_HEIGHT, point.z), obstacles)
  if (kind === 'door') return walkableInFront(point, from || new THREE.Vector3(point.x, EYE_HEIGHT, point.z - 1.2), obstacles)
  if (kind === 'mail' || kind === 'parcel' || kind === 'parcel-place' || kind === 'pile') {
    return walkableInFront(point, from || new THREE.Vector3(point.x - 1.2, EYE_HEIGHT, point.z), obstacles)
  }
  return walkableInFront(point, from || new THREE.Vector3(point.x, EYE_HEIGHT, point.z + 1.2), obstacles)
}

export default function FirstPersonController({ paused, focused, arranging, interactionItems, obstacles = [], look, onNearby, onInteract, onMetrics }) {
  const { camera, gl, scene } = useThree()
  const keys = useRef(new Set())
  const yaw = useRef(0)
  const pitch = useRef(0)
  const velocity = useRef(new THREE.Vector2())
  const bobPhase = useRef(0)
  const bobOffset = useRef(0)
  const standingHeight = useRef(EYE_HEIGHT)
  const lastMetric = useRef(0)
  const lastNearby = useRef(null)
  const frameAverage = useRef(16.7)
  const target = useRef(new THREE.Vector3())
  const focusTween = useRef(null)
  const restorePose = useRef(null)
  const activeFocus = useRef(null)
  const lookHeld = useRef(false)
  // C toggles crouch (it stays until C or Space); right-click cycles zoom.
  const crouched = useRef(false)
  const zoomLevel = useRef(0)
  const collideMeshes = useRef([])
  const cardTargets = useRef({ list: [], age: Infinity })
  const cardScan = useRef({ frame: CARD_SCAN_INTERVAL, hit: null })
  const obstaclesRef = useRef(obstacles)
  obstaclesRef.current = obstacles
  const lookRef = useRef(look)
  lookRef.current = look
  const clearInput = useCallback(() => {
    keys.current.clear()
    lookHeld.current = false
  }, [])

  useEffect(() => {
    camera.position.set(...SAFE_SPAWN.position)
    camera.rotation.order = 'YXZ'
    yaw.current = SAFE_SPAWN.yaw
    pitch.current = SAFE_SPAWN.pitch
    // DEV-only visual proofs: ?roomPose=x,z,yawDegrees,pitchDegrees
    const pose = import.meta.env.DEV ? new URLSearchParams(window.location.search).get('roomPose')?.split(',').map(Number) : null
    if (pose?.length >= 2 && pose.every(Number.isFinite)) {
      camera.position.set(pose[0], EYE_HEIGHT, pose[1])
      yaw.current = THREE.MathUtils.degToRad(pose[2] || 0)
      pitch.current = THREE.MathUtils.degToRad(pose[3] || 0)
    }
    camera.rotation.set(pitch.current, yaw.current, 0)
    restorePose.current = { position: camera.position.clone(), yaw: yaw.current, pitch: pitch.current }
  }, [camera])

  useEffect(() => {
    const down = event => {
      if (event.type === 'keydown') {
        if (MOVEMENT_CODES.has(event.code)) keys.current.add(event.code)
        if (event.code === 'KeyE' && !arranging) onInteract()
        if (event.code === 'KeyC' && !event.repeat && !paused && !focused) crouched.current = !crouched.current
        if (event.code === 'Space') crouched.current = false
      } else if (event.button === 2) {
        lookHeld.current = true
        if (!arranging && !paused && !focused && document.pointerLockElement === gl.domElement) {
          zoomLevel.current = (zoomLevel.current + 1) % ZOOM_LEVELS.length
        }
      }
    }
    const up = event => {
      if (event.type === 'keyup') keys.current.delete(event.code)
      if (event.button === 2) lookHeld.current = false
    }
    const move = event => {
      const looking = arranging ? lookHeld.current || event.buttons === 2 : document.pointerLockElement === gl.domElement
      if (!looking || paused || focused) return
      if (Math.abs(event.movementX) > MAX_LOOK_STEP || Math.abs(event.movementY) > MAX_LOOK_STEP) return
      // Slower look while zoomed in, so aiming stays steady.
      const sensitivity = LOOK_SCALE * (lookRef.current?.sensitivity || 1) / ZOOM_LEVELS[zoomLevel.current]
      yaw.current -= event.movementX * sensitivity
      pitch.current = THREE.MathUtils.clamp(pitch.current - event.movementY * sensitivity, -1.25, 1.25)
    }
    const click = () => { if (!paused && !focused && !arranging) gl.domElement.requestPointerLock?.() }
    const blockMenu = event => { if (arranging || document.pointerLockElement === gl.domElement) event.preventDefault() }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('mousedown', down)
    window.addEventListener('mouseup', up)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', clearInput)
    window.addEventListener('blur', clearInput)
    document.addEventListener('visibilitychange', clearInput)
    document.addEventListener('mousemove', move)
    gl.domElement.addEventListener('click', click)
    gl.domElement.addEventListener('contextmenu', blockMenu)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('mousedown', down)
      window.removeEventListener('mouseup', up)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', clearInput)
      window.removeEventListener('blur', clearInput)
      document.removeEventListener('visibilitychange', clearInput)
      document.removeEventListener('mousemove', move)
      gl.domElement.removeEventListener('click', click)
      gl.domElement.removeEventListener('contextmenu', blockMenu)
    }
  }, [arranging, clearInput, focused, gl, onInteract, paused])

  useEffect(() => {
    clearInput()
    velocity.current.set(0, 0)
    // Panels, placement and pausing return to a normal standing view.
    if (arranging || focused || paused) zoomLevel.current = 0
    if (arranging || focused) crouched.current = false
  }, [arranging, clearInput, focused, paused])

  useEffect(() => {
    if (!focused?.position) {
      keys.current.clear()
      focusTween.current = null
      if (activeFocus.current && restorePose.current) {
        const pose = safePose(restorePose.current.position, restorePose.current.yaw, restorePose.current.pitch, obstaclesRef.current)
        camera.position.copy(pose.position)
        yaw.current = pose.yaw
        pitch.current = pose.pitch
        camera.rotation.set(pitch.current, yaw.current, 0)
      } else {
        yaw.current = camera.rotation.y
        pitch.current = THREE.MathUtils.clamp(camera.rotation.x, -1.1, 1.1)
      }
      camera.position.y = EYE_HEIGHT
      standingHeight.current = EYE_HEIGHT
      bobOffset.current = 0
      activeFocus.current = null
      return
    }
    if (!activeFocus.current) {
      keys.current.clear()
      restorePose.current = safePose(camera.position, yaw.current, pitch.current, obstaclesRef.current)
      activeFocus.current = focused.key || focused.interactive || true
    }
    const point = new THREE.Vector3(...focused.position)
    point.y = Math.max(1.05, Math.min(1.65, point.y || 1.25))
    const approach = safePose(focusApproach(focused, point, camera.position, obstaclesRef.current), yaw.current, pitch.current, obstaclesRef.current).position
    // Tween the view direction too, so the camera turns smoothly instead of
    // snapping to face the object on the first frame.
    const startQuaternion = camera.quaternion.clone()
    const endQuaternion = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(approach, point, upAxis))
    focusTween.current = { start: camera.position.clone(), end: approach, startQuaternion, endQuaternion, elapsed: 0 }
  }, [camera, focused])

  useEffect(() => {
    document.exitPointerLock?.()
    camera.position.y = EYE_HEIGHT
    standingHeight.current = EYE_HEIGHT
    pitch.current = THREE.MathUtils.clamp(pitch.current, -.85, .85)
    camera.rotation.set(pitch.current, yaw.current, 0)
  }, [arranging, camera])

  useFrame((state, rawDelta) => {
    // Clamp long frames (tab switches, hitches) so movement never teleports.
    const delta = Math.min(rawDelta, .05)
    if (focusTween.current && focused) {
      const tween = focusTween.current
      tween.elapsed += delta
      const amount = 1 - Math.pow(1 - Math.min(1, tween.elapsed / .58), 3)
      camera.position.lerpVectors(tween.start, tween.end, amount)
      camera.quaternion.slerpQuaternions(tween.startQuaternion, tween.endQuaternion, amount)
      camera.rotation.setFromQuaternion(camera.quaternion, 'YXZ')
      yaw.current = camera.rotation.y
      pitch.current = camera.rotation.x
    } else {
      camera.rotation.set(pitch.current, yaw.current, 0)
    }
    // Ease the field of view towards the chosen zoom level.
    const wantedFov = BASE_FOV / ZOOM_LEVELS[zoomLevel.current]
    if (Math.abs(camera.fov - wantedFov) > .01) {
      camera.fov += (wantedFov - camera.fov) * (1 - Math.exp(-ZOOM_RATE * delta))
      if (Math.abs(camera.fov - wantedFov) <= .01) camera.fov = wantedFov
      camera.updateProjectionMatrix()
    }
    if (!collideMeshes.current.length) {
      const found = []
      scene.traverse(node => { if (node.isMesh && node.userData.collide) found.push(node) })
      collideMeshes.current = found
    }
    const canWalk = (!paused && !focused) || arranging
    if (canWalk) {
      const crouching = crouched.current
      const rising = keys.current.has('Space')
      // Space raises the view within the room; C eases into a crouch.  The
      // standing height eases too, so neither one snaps.
      if (rising) standingHeight.current = Math.min(CEILING_EYE_HEIGHT, standingHeight.current + WALK_SPEED * delta)
      else if (crouching) standingHeight.current = Math.max(FLOOR_Y + CROUCH_EYE_HEIGHT, standingHeight.current - WALK_SPEED * delta)
      else if (standingHeight.current < EYE_HEIGHT) standingHeight.current = Math.min(EYE_HEIGHT, standingHeight.current + WALK_SPEED * 1.4 * delta)

      const forward = Number(keys.current.has('KeyW')) - Number(keys.current.has('KeyS'))
      const side = Number(keys.current.has('KeyD')) - Number(keys.current.has('KeyA'))
      const sprinting = (keys.current.has('ShiftLeft') || keys.current.has('ShiftRight')) && !crouching && forward > 0
      const speed = crouching ? WALK_SPEED * .55 : sprinting ? SPRINT_SPEED : WALK_SPEED
      const wanted = moveDirection.set(side, 0, -forward)
      if (wanted.lengthSq() > 0) wanted.normalize().applyAxisAngle(upAxis, yaw.current).multiplyScalar(speed)
      // Ease velocity toward the input: quick to start, a short glide to stop.
      const rate = wanted.lengthSq() > 0 ? ACCELERATION : DECELERATION
      const blend = 1 - Math.exp(-rate * delta)
      const v = velocity.current
      v.x += (wanted.x - v.x) * blend
      v.y += (wanted.z - v.y) * blend
      if (Math.abs(v.x) < .002 && Math.abs(v.y) < .002) v.set(0, 0)
      if (v.x || v.y) {
        const nextX = camera.position.x + v.x * delta
        const nextZ = camera.position.z + v.y * delta
        const walls = collideMeshes.current
        const extra = obstaclesRef.current
        // Resolve each axis separately so the player slides along walls.
        if (!isBlocked(nextX, camera.position.z, extra, camera.position.x, camera.position.z) && !rayBlocked(camera.position, nextX, camera.position.z, walls)) camera.position.x = nextX
        else v.x = 0
        if (!isBlocked(camera.position.x, nextZ, extra, camera.position.x, camera.position.z) && !rayBlocked(camera.position, camera.position.x, nextZ, walls)) camera.position.z = nextZ
        else v.y = 0
      }
      // A gentle head bob tied to real ground speed (off in placement mode).
      const groundSpeed = Math.hypot(v.x, v.y)
      const bobbing = lookRef.current?.headBob !== false && !arranging && groundSpeed > .3
      if (bobbing) bobPhase.current += delta * groundSpeed * 4.2
      const bobTarget = bobbing ? Math.sin(bobPhase.current) * .022 * Math.min(1, groundSpeed / WALK_SPEED) : 0
      bobOffset.current += (bobTarget - bobOffset.current) * (1 - Math.exp(-12 * delta))
      camera.position.y = standingHeight.current + bobOffset.current
    }
    let best = null
    // Prompts are hidden while paused or focused, so skip the scan entirely.
    if (!arranging && !paused && !focused) {
      camera.getWorldDirection(target.current)
      let cardCandidateNear = false
      const candidates = []
      interactionItems.forEach(item => {
        const point = scratchPoint.set(...item.position)
        if (item.interactive !== 'card-inspect') point.y = Math.max(point.y, 1.15)
        const offset = point.sub(camera.position); const distance = offset.length()
        const facing = distance ? target.current.dot(offset.normalize()) : 0
        if (distance >= INTERACT_RANGE || facing <= .42) return
        if (item.interactive === 'card-inspect') { cardCandidateNear = true; return }
        candidates.push({ item, score: facing / distance, distance })
      })
      // Best-scoring prompt that is not behind a wall.  Usually one ray.
      candidates.sort((left, right) => right.score - left.score)
      for (const candidate of candidates) {
        const point = scratchPoint.set(...candidate.item.position)
        if (candidate.item.interactive !== 'card-inspect') point.y = Math.max(point.y, 1.15)
        if (!lineOfSightBlocked(camera.position, point, collideMeshes.current)) {
          best = { ...candidate.item, score: candidate.score }
          break
        }
      }
      // Cards need a real reticle hit.  Only cast when a card is actually in
      // range, and only every few frames; the prompt does not need 60 Hz.
      if (cardCandidateNear) {
        const scan = cardScan.current
        scan.frame += 1
        if (scan.frame >= CARD_SCAN_INTERVAL) {
          scan.frame = 0
          const cards = cardTargets.current
          cards.age += 1
          if (cards.age > 60) {
            cards.list = []
            scene.traverse(node => { if (node.userData?.interactionKey) cards.list.push(node) })
            cards.age = 0
          }
          scan.hit = cards.list.length ? reticleCardKey(camera, [...cards.list, ...collideMeshes.current]) : null
        }
        if (scan.hit) {
          const item = interactionItems.find(entry => entry.key === scan.hit.key)
          if (item && (!best || 1 / Math.max(.2, scan.hit.distance) > best.score)) best = { ...item, score: 1 / Math.max(.2, scan.hit.distance) }
        }
      } else {
        cardScan.current.hit = null
        cardScan.current.frame = CARD_SCAN_INTERVAL
      }
    }
    const nearbyKey = best?.key || null
    if (nearbyKey !== lastNearby.current) {
      lastNearby.current = nearbyKey
      onNearby(best ? { ...best, copy: best.copy || INTERACTION_COPY[best.interactive] } : null)
    }
    if (rawDelta < .25) frameAverage.current = frameAverage.current * .92 + rawDelta * 1000 * .08
    if (onMetrics && state.clock.elapsedTime - lastMetric.current > .5) {
      lastMetric.current = state.clock.elapsedTime
      onMetrics({ frameMs: Math.round(frameAverage.current * 10) / 10, calls: gl.info.render.calls, triangles: gl.info.render.triangles, textures: gl.info.memory.textures, geometries: gl.info.memory.geometries })
    }
  })
  return null
}

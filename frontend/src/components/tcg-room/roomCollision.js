import * as THREE from 'three'
import { COLLISION_BOXES, WALK_BOUNDS } from './roomLayout'

export const PLAYER_RADIUS = .28
const BODY_RADIUS = .2

const heading = new THREE.Vector3()
const origin = new THREE.Vector3()
const caster = new THREE.Raycaster()

const inWalk = (x, z) => x >= WALK_BOUNDS.minX && x <= WALK_BOUNDS.maxX && z >= WALK_BOUNDS.minZ && z <= WALK_BOUNDS.maxZ
const inBox = (box, x, z, pad) => x > box.min[0] - pad && x < box.max[0] + pad && z > box.min[1] - pad && z < box.max[1] + pad

/**
 * True when the player's body would end up inside the room furniture or a
 * placed item.  A box the player is already standing in (for example furniture
 * that was just placed on top of them) never traps them: they can walk out.
 */
export function isBlocked(x, z, obstacles = [], fromX = x, fromZ = z) {
  if (!inWalk(x, z)) return true
  for (const box of COLLISION_BOXES) {
    if (inBox(box, x, z, BODY_RADIUS) && !inBox(box, fromX, fromZ, BODY_RADIUS)) return true
  }
  for (const box of obstacles) {
    if (inBox(box, x, z, BODY_RADIUS) && !inBox(box, fromX, fromZ, BODY_RADIUS)) return true
  }
  return false
}

export function isStandingFree(x, z, obstacles = []) {
  return inWalk(x, z) && !COLLISION_BOXES.some(box => inBox(box, x, z, BODY_RADIUS)) && !obstacles.some(box => inBox(box, x, z, BODY_RADIUS))
}

/** Rays at knee and chest height against the authored walls and doors. */
export function rayBlocked(from, toX, toZ, meshes) {
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
    const hit = caster.intersectObjects(meshes, false)[0]
    if (hit && hit.distance < dist + PLAYER_RADIUS) return true
  }
  return false
}

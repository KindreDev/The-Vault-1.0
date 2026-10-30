// Client-side placement rules.  These mirror backend/services/tcg_room.py and
// room_geometry.py so the ghost turns red before the server would refuse it.
import { AUTHORED_SURFACES, COLLISION_BOXES, ROOM_SIZE, SHELF_SUPPORT_SLOTS, SURFACE_ASSETS, SURFACE_HOST_ASSETS, WALL_BASE_ORIGIN_ASSETS } from './roomLayout'

export const GRID_SIZE = .25
export const ROTATE_STEP = Math.PI / 4
export const FINE_ROTATE_STEP = Math.PI / 12

// Floor triangles (XZ) of the authored room, registered once the base room
// GLB has loaded.  Matches room_geometry.authored_room_geometry floors.
let floorTriangles = []
const POINT_TOLERANCE = .012

export function registerFloorTriangles(triangles) {
  floorTriangles = triangles
}

function insideFloor(px, pz) {
  if (!floorTriangles.length) return true
  for (const [ax, az, bx, bz, cx, cz] of floorTriangles) {
    const denominator = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz)
    if (Math.abs(denominator) <= 1e-9) continue
    const alpha = ((bz - cz) * (px - cx) + (cx - bx) * (pz - cz)) / denominator
    const beta = ((cz - az) * (px - cx) + (ax - cx) * (pz - cz)) / denominator
    if (Math.min(alpha, beta, 1 - alpha - beta) >= -POINT_TOLERANCE) return true
  }
  return false
}

function floorFootprintSupported(position, yaw, width, depth) {
  const cosine = Math.cos(yaw)
  const sine = Math.sin(yaw)
  for (let row = 0; row < 5; row += 1) {
    const zOffset = (row / 4 - .5) * depth
    for (let column = 0; column < 5; column += 1) {
      const xOffset = (column / 4 - .5) * width
      if (!insideFloor(position.x + cosine * xOffset + sine * zOffset, position.z - sine * xOffset + cosine * zOffset)) return false
    }
  }
  return true
}

export function placementBox(definition, value) {
  const footprint = definition?.footprint || { width: .5, depth: .5 }
  const yaw = value.rotation?.y || 0
  const cosine = Math.abs(Math.cos(yaw))
  const sine = Math.abs(Math.sin(yaw))
  const width = cosine * (footprint.width || .5) + sine * (footprint.depth || .5)
  const depth = sine * (footprint.width || .5) + cosine * (footprint.depth || .5)
  return { minX: value.position.x - width / 2, maxX: value.position.x + width / 2, minZ: value.position.z - depth / 2, maxZ: value.position.z + depth / 2 }
}

export const overlaps = (a, b) => a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ

function wallBox(definition, value) {
  const footprint = definition?.footprint || { width: .5, depth: .5 }
  const yaw = value.rotation?.y || 0
  const normalX = Math.sin(yaw)
  const normalZ = Math.cos(yaw)
  const axis = Math.abs(normalX) >= Math.abs(normalZ) ? 'x' : 'z'
  const coordinate = axis === 'x' ? value.position.x : value.position.z
  const tangent = axis === 'x' ? value.position.z : value.position.x
  const tangentSize = axis === 'x'
    ? Math.abs(Math.sin(yaw)) * (footprint.width || .5) + Math.abs(Math.cos(yaw)) * (footprint.depth || .5)
    : Math.abs(Math.cos(yaw)) * (footprint.width || .5) + Math.abs(Math.sin(yaw)) * (footprint.depth || .5)
  const height = Math.max(.05, definition?.footprint?.height || .5)
  const baseOrigin = WALL_BASE_ORIGIN_ASSETS.has(definition?.asset_id)
  return {
    axis,
    coordinate,
    normalSign: axis === 'x' ? (normalX >= 0 ? 1 : -1) : (normalZ >= 0 ? 1 : -1),
    tangentMin: tangent - tangentSize / 2,
    tangentMax: tangent + tangentSize / 2,
    verticalMin: baseOrigin ? value.position.y : value.position.y - height / 2,
    verticalMax: baseOrigin ? value.position.y + height : value.position.y + height / 2,
  }
}

const wallOverlaps = (a, b) => a.axis === b.axis && a.normalSign === b.normalSign && Math.abs(a.coordinate - b.coordinate) <= .16 && a.tangentMin < b.tangentMax && a.tangentMax > b.tangentMin && a.verticalMin < b.verticalMax && a.verticalMax > b.verticalMin

function surfaceHosts(placed, definitions, instances) {
  const hosts = AUTHORED_SURFACES.map(host => ({ ...host }))
  for (const row of placed) {
    const instance = instances.find(item => item.id === row.instance_id)
    const other = definitions.get(instance?.definition_id)
    if (!other || !SURFACE_HOST_ASSETS.has(other.asset_id)) continue
    const slots = other.footprint?.support_slots || SHELF_SUPPORT_SLOTS[other.asset_id] || []
    for (const slot of slots) {
      const slotBox = placementBox({ footprint: { width: slot.width, depth: slot.depth } }, row.transform)
      hosts.push({ minX: slotBox.minX, maxX: slotBox.maxX, minZ: slotBox.minZ, maxZ: slotBox.maxZ, top: (row.transform?.position?.y || 0) + slot.y })
    }
  }
  return hosts
}

const isShelf = definition => Boolean(definition && SURFACE_HOST_ASSETS.has(definition.asset_id))

const AUTHORED_OBSTACLES = COLLISION_BOXES.map(box => ({ minX: box.min[0], maxX: box.max[0], minZ: box.min[1], maxZ: box.max[1] }))

export function validatePlacement(definition, value, placed, definitions, instances, selectedId) {
  const { position } = value
  if (definition?.placement_kind === 'wall') {
    if (position.y < .12 || position.y > 2.75) return 'Keep it on the wall'
    const box = wallBox(definition, value)
    if (box.verticalMin < 0 || box.verticalMax > ROOM_SIZE.height) return 'Keep the whole item within the wall height'
    for (const row of placed) {
      if (row.instance_id === selectedId) continue
      const instance = instances.find(item => item.id === row.instance_id)
      const other = definitions.get(instance?.definition_id)
      if (isShelf(definition) && isShelf(other) && overlaps(box, placementBox(other, row.transform))) return 'This overlaps another shelf'
      if (other?.placement_kind === 'wall' && wallOverlaps(box, wallBox(other, row.transform))) return 'This overlaps another wall item'
    }
    return null
  }
  const box = placementBox(definition, value)
  if (SURFACE_ASSETS.has(definition?.asset_id)) {
    const host = surfaceHosts(placed, definitions, instances).find(item => (
      Math.abs(position.y - item.top) <= .10 &&
      box.minX >= item.minX && box.maxX <= item.maxX &&
      box.minZ >= item.minZ && box.maxZ <= item.maxZ
    ))
    if (!host) return 'Place this on a table, desk, stand, or counter — not the floor'
    return null
  }
  const footprint = definition?.footprint || {}
  if (AUTHORED_OBSTACLES.some(obstacle => overlaps(box, obstacle))) return 'This is blocked by a wall or the room furniture'
  if (!floorFootprintSupported(position, value.rotation?.y || 0, footprint.width || .5, footprint.depth || .5)) return 'Keep the whole item on the floor'
  for (const row of placed) {
    if (row.instance_id === selectedId) continue
    const instance = instances.find(item => item.id === row.instance_id)
    const other = definitions.get(instance?.definition_id)
    if (isShelf(other) && overlaps(box, placementBox(other, row.transform))) return 'This overlaps another shelf'
    if (other?.placement_kind === 'floor' && !SURFACE_ASSETS.has(other.asset_id) && overlaps(box, placementBox(other, row.transform))) return 'This overlaps another placed item'
  }
  return null
}

const snap = (value, step) => Math.round(value / step) * step

/** Sims-style build grid: footprint edges land on grid lines when square to the room. */
export function snapFloorPoint(x, z, definition, yaw) {
  const footprint = definition?.footprint || { width: .5, depth: .5 }
  const quarter = Math.abs(Math.round(yaw / (Math.PI / 2)) * (Math.PI / 2) - yaw) < .01
  if (!quarter) return { x: snap(x, GRID_SIZE / 2), z: snap(z, GRID_SIZE / 2) }
  const swapped = Math.abs(Math.sin(yaw)) > .5
  const width = swapped ? footprint.depth || .5 : footprint.width || .5
  const depth = swapped ? footprint.width || .5 : footprint.depth || .5
  return {
    x: snap(x - width / 2, GRID_SIZE) + width / 2,
    z: snap(z - depth / 2, GRID_SIZE) + depth / 2,
  }
}

export function snapWallPoint(sample) {
  const alongX = Math.abs(Math.sin(sample.yaw)) < .5
  return {
    ...sample,
    x: alongX ? snap(sample.x, GRID_SIZE / 2) : sample.x,
    z: alongX ? sample.z : snap(sample.z, GRID_SIZE / 2),
    y: snap(sample.y, GRID_SIZE / 2),
  }
}

export function stepRotation(yaw, direction, fine = false) {
  const step = fine ? FINE_ROTATE_STEP : ROTATE_STEP
  return Math.round((snap(yaw, step) + direction * step) * 1000) / 1000
}

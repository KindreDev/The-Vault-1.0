export const ROOM_SIZE = { width: 9.46, depth: 10.55, height: 3.0 }

// Authored apartment is Z-up in Blender. The GLB is Y-up: Three (x, y, z) = Blender (x, z, -y).
// Outer walls sit near x[-5, 4], z[-5.2, 5.2], floor top y≈0.17. Not a centred 12×12 box.
export const FLOOR_Y = .17

export const WALK_BOUNDS = Object.freeze({
  minX: -4.78, maxX: 3.78, minZ: -4.78, maxZ: 4.78,
})

export const EYE_HEIGHT = 1.68

export const SAFE_SPAWN = Object.freeze({
  position: [3.06, EYE_HEIGHT, 4.15],
  yaw: 0,
  pitch: 0,
})

export const BLUE_BOXES = Object.freeze({
  inbox: { position: [2.99, 1.04, -.39], offsetZ: 0 },
  pile: { position: [2.99, 1.04, -1.17], offsetZ: -.78 },
})

export const PARCEL_SURFACES = Object.freeze({
  desk: [-4.39, .855, -3.6],
  dining_table: [3.02, .932, -.8],
  sorting_mat: BLUE_BOXES.inbox.position,
})

export const AUTHORED_FURNITURE = Object.freeze(new Set([
  'card_display_stand', 'card_display_stand_white', 'card_display_stand_black',
  'graded_card_stand', 'graded_card_stand_white', 'graded_card_stand_black',
  'glass_display_cabinet', 'glass_display_case', 'floating_glass_cabinet',
]))

export const FURNITURE_FILE = Object.freeze({
  card_display_stand: 'card_display_stand_white',
  graded_card_stand: 'graded_card_stand_black',
})

// The shop renders for the compact stand were captured from the reverse side
// of the holder.  The room mesh itself has the correct local orientation; only
// the 2D preview needs the front-facing mirror.  Use the white wide-stand
// render for the black variant so its silhouette does not disappear into the
// dark placement rail.
export const FURNITURE_PREVIEW_FILE = Object.freeze({
  graded_card_stand: 'graded_card_stand_white',
  graded_card_stand_black: 'graded_card_stand_white',
})

export const FURNITURE_PREVIEW_MIRROR_X = Object.freeze(new Set([
  'card_display_stand', 'card_display_stand_white', 'card_display_stand_black',
]))

// The compact holder GLBs were authored with their display face toward the
// back of the room. Keep persisted placement yaw intact and apply this local
// model correction everywhere the authored mesh is rendered.
export const FURNITURE_MODEL_YAW_OFFSET = Object.freeze(new Set([
  'card_display_stand', 'card_display_stand_white', 'card_display_stand_black',
]))

export function furniturePreviewAssetId(assetId) {
  return FURNITURE_PREVIEW_FILE[assetId] || assetId
}

export function furniturePreviewMirrorX(assetId) {
  return FURNITURE_PREVIEW_MIRROR_X.has(assetId)
}

export function furnitureModelYawOffset(assetId) {
  return FURNITURE_MODEL_YAW_OFFSET.has(assetId) ? Math.PI : 0
}

export function furnitureDisplayName(name, assetId, variantKey = '') {
  const value = String(name || 'Room item')
  const isCardStand = /^(?:card_display_stand|graded_card_stand)(?:_|$)/i.test(String(assetId || ''))
  if (!isCardStand) return value
  if (/\((?:black|white)\)\s*$/i.test(value)) return value
  const assetColor = String(assetId || '').match(/(?:^|_)(black|white)$/i)?.[1]
  const color = assetColor || String(variantKey || '').match(/^(black|white)$/i)?.[1]
  return color ? `${value} (${color.toLowerCase()})` : value
}

export const COMPUTER_SCREEN = Object.freeze({
  // Monitor glass faces +X. PlaneGeometry faces +Z, so yaw +90°.
  position: [-4.45, 1.254, -3.58],
  rotation: [0, Math.PI / 2, 0],
  size: [.76, .38],
})

const p = (assetId, position, rotation = [0, 0, 0], scale = 1, zone = 'shell', interactive = null) => ({
  key: `${assetId}-${position.join('-')}`, assetId, position, rotation, scale, zone, interactive,
})

// Interaction anchors only. Visuals come from /tcg-room/base_room.glb.
export const AUTHORED_ROOM = [
  p('pc_monitor', [-4.45, 1.25, -3.58], [0, Math.PI / 2, 0], 1, 'computer', 'computer'),
  p('bedroom_door', [3.06, 1.35, 4.89], [0, 0, 0], 1, 'entry', 'door'),
  p('plastic_bin_inbox', BLUE_BOXES.inbox.position, [0, 0, 0], 1, 'entry', 'mail'),
]

export const COLLISION_BOXES = [
  { min: [-4.73, -4.4], max: [-4.07, -2.81] },
  { min: [2.63, -1.77], max: [3.42, .18] },
  { min: [-5.05, -2.22], max: [-1.95, -1.98] },
  { min: [1.95, -2.22], max: [4.05, -1.98] },
  { min: [-5.05, 1.92], max: [2.05, 2.08] },
  { min: [1.92, 2], max: [2.08, 5.05] },
]

export const INTERACTION_COPY = {
  computer: ['Use computer', 'Browse your collection and shop from the monitor'],
  door: ['Visit trader', "Step outside to meet this week's visitor"],
  mail: ['Open deliveries', 'Collect booster packs that arrived on the table'],
  parcel: ['Open booster packs', 'Unpack the delivered booster packs'],
  'parcel-place': ['Place booster packs', 'Set them down on a clear surface'],
  pile: ['Organize cards', 'Physical cards in this box'],
  binder: ['Open binder', 'Manage the same binder used by the 2D collection'],
  cabinet: ['Open cabinet', 'Assign physical copies to cabinet slots'],
  display: ['Manage cards', 'Put cards in this stand, or hold one to inspect foil'],
  poster: ['Manage poster', 'Change this wall display assignment'],
}

export const PLACEMENT_BOUNDS = Object.freeze({
  wallY: { min: .12, max: 2.75 },
})

// These authored GLBs use their floor/base as the transform origin. Posters
// and other module wall decor use a centered transform origin.
export const WALL_BASE_ORIGIN_ASSETS = Object.freeze(new Set(['floating_glass_cabinet']))

export const SURFACE_ASSETS = Object.freeze(new Set([
  'card_display_stand', 'card_display_stand_white', 'card_display_stand_black',
  'graded_card_stand', 'graded_card_stand_white', 'graded_card_stand_black',
]))

// Mesh-local slots. Positive tilt leans the card back into the plate/riser.
// Wide-stand shelves/lips are measured from the exported mesh at
// y≈.003/.018, .123/.138, and .242/.258. The wide mesh faces -Z; the compact
// stand faces +Z, so each family carries its own local facing yaw.
// Single-stand offsets are authored on the native GLB, then scaled with the mesh.
// The compact holder's inner groove is around native z≈.01.  The holder opens
// toward local +Z, so keep the card just forward of that groove; the previous
// negative-Z offset put it inside/behind the rear plate and made it disappear
// on the real compact stand.
// The card sits just above the holder's front lip.  Keep this as a local
// stand-space lift (rather than a world-Y move) so the existing lean/angle is
// untouched when the furniture is rotated around the room.
const singleSlot = [{ x: -.004, y: .142, z: -.0173, tilt: .227, yaw: -.13313, scale: .76 }]
const wideSlots = Array.from({ length: 9 }, (_, index) => {
  const col = index % 3
  const row = Math.floor(index / 3)
  // Lift each card clear of the shelf lip while preserving its authored tilt.
  const y = [.06747, .18715, .30684][row]
  const z = [-.055, -.002, .051][row]
  return { x: (col - 1) * .088, y, z, tilt: -.30, yaw: Math.PI }
})

export const DISPLAY_SLOTS = Object.freeze({
  card_display_stand: singleSlot,
  card_display_stand_white: singleSlot,
  card_display_stand_black: singleSlot,
  graded_card_stand: wideSlots,
  graded_card_stand_white: wideSlots,
  graded_card_stand_black: wideSlots,
})

const SINGLE_STANDS = new Set([
  'card_display_stand', 'card_display_stand_white', 'card_display_stand_black',
])

export function standMeshScale(assetId) {
  return SINGLE_STANDS.has(assetId) ? .42 : 1
}

export function displaySlotsFor(assetId) {
  const slots = DISPLAY_SLOTS[assetId] || DISPLAY_SLOTS.card_display_stand_white
  const scale = standMeshScale(assetId)
  if (scale === 1) return slots
  return slots.map(slot => ({ ...slot, x: slot.x * scale, y: slot.y * scale, z: slot.z * scale }))
}

export function displaySlotCount(assetId) {
  return (DISPLAY_SLOTS[assetId] || []).length
}

export const SURFACE_HOST_ASSETS = Object.freeze(new Set([
  'glass_display_cabinet', 'glass_display_case', 'floating_glass_cabinet',
]))

// Shelf tops measured from each authored furniture GLB origin.  Card stands
// can be placed on any of these openings, not only on the cabinet's roof.
export const SHELF_SUPPORT_SLOTS = Object.freeze({
  glass_display_case: Object.freeze([
    { y: .02, width: .52, depth: .52 },
    { y: .54, width: .52, depth: .52 },
    { y: 1.07, width: .52, depth: .52 },
    { y: 1.60, width: .52, depth: .52 },
    { y: 2.11, width: .52, depth: .52 },
  ]),
  glass_display_cabinet: Object.freeze([
    { y: .72, width: .48, depth: .30 },
    { y: 1.14, width: .48, depth: .30 },
    { y: 1.56, width: .48, depth: .30 },
    { y: 1.97, width: .48, depth: .30 },
    { y: 2.38, width: .48, depth: .30 },
  ]),
  floating_glass_cabinet: Object.freeze([
    { y: .04, width: .62, depth: .24 },
    { y: .47, width: .62, depth: .24 },
    { y: .91, width: .62, depth: .24 },
    { y: 1.35, width: .62, depth: .24 },
    { y: 1.78, width: .62, depth: .24 },
  ]),
})

export const AUTHORED_SURFACES = Object.freeze([
  { id: 'desk', minX: -4.73, maxX: -4.07, minZ: -4.4, maxZ: -2.81, top: .855 },
  { id: 'dining', minX: 2.63, maxX: 3.42, minZ: -1.77, maxZ: .18, top: .932 },
])

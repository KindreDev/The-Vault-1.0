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

export const PARCEL_SURFACES = Object.freeze({
  desk: [-4.39, .855, -3.6],
  dining_table: [3.02, .932, -.8],
  sorting_mat: [3.02, .932, -.8],
})

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
  p('door_mail_slot', [2.48, .95, 4.86], [0, 0, 0], 1, 'entry', 'mail'),
  p('dining_table', [3.02, .4, -.8], [0, 0, 0], 1, 'dining', 'parcel-place'),
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
  mail: ['Check mail', 'Collect a delivered parcel'],
  parcel: ['Pick up parcel', 'Carry it to a surface before opening'],
  'parcel-place': ['Place carried parcel', 'Set it down on a clear surface'],
  pile: ['Organize cards', 'Inspect and move physical copies from the unorganized pile'],
  binder: ['Open binder', 'Manage the same binder used by the 2D collection'],
  cabinet: ['Open cabinet', 'Assign physical copies to cabinet slots'],
  display: ['Manage display', 'Mount a physical card for display'],
  poster: ['Manage poster', 'Change this wall display assignment'],
}

export const PLACEMENT_BOUNDS = Object.freeze({
  floor: { minX: -4.85, maxX: 3.85, minZ: -4.85, maxZ: 4.85 },
  wallY: { min: .35, max: 2.75 },
})

export const SURFACE_ASSETS = Object.freeze(new Set([
  'acrylic_card_case', 'card_toploader', 'desk_lamp', 'set_storage_box',
]))

export const SURFACE_HOST_ASSETS = Object.freeze(new Set([
  'computer_desk', 'dining_table', 'nightstand',
  'display_stand_single', 'display_stand_triple', 'card_drawer_unit',
  'floating_wall_shelf', 'glass_cabinet_wide', 'glass_cabinet_tall',
]))

export const AUTHORED_SURFACES = Object.freeze([
  { id: 'desk', minX: -4.73, maxX: -4.07, minZ: -4.4, maxZ: -2.81, top: .855 },
  { id: 'dining', minX: 2.63, maxX: 3.42, minZ: -1.77, maxZ: .18, top: .932 },
])

export const ROOM_SIZE = { width: 12, depth: 12, height: 3.2 }

export const PARCEL_SURFACES = Object.freeze({
  desk: [3.8, .82, -4.8],
  dining_table: [.15, .82, 3.3],
})

const p = (assetId, position, rotation = [0, 0, 0], scale = 1, zone = 'shell', interactive = null) => ({
  key: `${assetId}-${position.join('-')}`, assetId, position, rotation, scale, zone, interactive,
})

// This is the permanent room, not a showroom. Everything collectible or
// decorative comes from the player's owned-instance layout. The two window
// assemblies use the exact scaled opening centres from wall_south_windowed.
export const AUTHORED_ROOM = [
  p('room_floor', [0, 0, 0], [0, 0, 0], [4 / 3, 1, 12 / 7]),
  p('room_ceiling', [0, 3.2, 0], [0, 0, 0], [4 / 3, 1, 12 / 7]),
  p('wall_north', [0, 0, -6], [0, 0, 0], [4 / 3, 3.2 / 3, 1]),
  p('wall_south_windowed', [0, 0, 6], [0, Math.PI, 0], [4 / 3, 3.2 / 3, 1]),
  p('wall_east', [6, 0, 0], [0, -Math.PI / 2, 0], [12 / 7, 3.2 / 3, 1]),
  p('wall_west_door', [-6, 0, 0], [0, Math.PI / 2, 0], [12 / 7, 3.2 / 3, 1]),
  ...[-3.133, 3.133].map(x =>
    p('window_double', [x, 1.25, 5.92], [0, Math.PI, 0], [4 / 3, 1, 1], 'window')),
  p('bedroom_door', [-5.91, 0, 0], [0, Math.PI / 2, 0], 1, 'entry', 'door'),
  p('door_mail_slot', [-5.80, .65, .25], [0, Math.PI / 2, 0], 1, 'entry', 'mail'),

  // Deliberate work zone. The monitor screen faces the room; this is the only
  // computer access point and there is no duplicate laptop/notebook.
  p('computer_desk', [3.8, 0, -5.18], [0, 0, 0], 1, 'computer'),
  p('pc_tower', [4.85, .78, -5.22], [0, 0, 0], 1, 'computer'),
  p('pc_monitor', [3.8, .78, -5.38], [0, 0, 0], 1, 'computer', 'computer'),
  p('pc_keyboard', [3.7, .79, -4.82], [0, 0, 0], 1, 'computer'),
  p('pc_mouse', [4.48, .79, -4.79], [0, 0, 0], 1, 'computer'),

  // A real kitchen zone occupies the full south-east corner. The divider is
  // 3.7 m from the east wall, leaving a usable kitchen instead of a narrow gap.
  p('kitchen_partition', [2.3, 0, 3.85], [0, Math.PI / 2, 0], 1, 'kitchen'),
  p('kitchen_counter', [5.18, 0, 3.0], [0, -Math.PI / 2, 0], 1, 'kitchen'),
  p('upper_kitchen_cabinet', [5.72, 1.48, 3.0], [0, -Math.PI / 2, 0], 1, 'kitchen'),
  p('refrigerator', [5.2, 0, 4.75], [0, Math.PI, 0], 1, 'kitchen'),
  p('microwave', [5.18, 1.03, 2.5], [0, -Math.PI / 2, 0], 1, 'kitchen'),
  p('kitchen_sink', [5.18, .86, 3.35], [0, -Math.PI / 2, 0], 1, 'kitchen'),
  p('dining_table', [-.15, 0, 3.35], [0, 0, 0], 1, 'dining', 'parcel-place'),
  p('ceiling_light', [0, 3.02, 0], [0, 0, 0], 1, 'lighting'),
]

// Only permanent furniture blocks walking. Owned placements add their own
// footprints at runtime; the entrance lane and the central route stay open.
export const COLLISION_BOXES = [
  { min: [2.25, -5.72], max: [5.45, -3.55] },
  { min: [4.55, 1.55], max: [5.72, 5.4] },
  { min: [-1.65, 2.55], max: [1.35, 4.15] },
  { min: [2.05, 2.15], max: [2.58, 5.55] },
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
  floor: { minX: -5.55, maxX: 5.55, minZ: -5.55, maxZ: 5.55 },
  wallY: { min: .35, max: 2.75 },
})

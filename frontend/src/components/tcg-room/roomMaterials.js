import * as THREE from 'three'

/**
 * KHR_materials_transmission makes three.js render the whole scene a second
 * time every frame to feed the glass.  The room's panes are thin and flat, so
 * plain alpha blending looks the same at a fraction of the cost.
 */
export function cheapGlass(material, opacity = .18) {
  if (!material || material.userData.vaultCheapGlass) return material
  if ('transmission' in material) material.transmission = 0
  if ('thickness' in material) material.thickness = 0
  material.transparent = true
  material.opacity = Math.min(material.opacity ?? 1, opacity)
  material.depthWrite = false
  material.side = THREE.DoubleSide
  material.userData.vaultCheapGlass = true
  material.needsUpdate = true
  return material
}

export const GLASS_PATTERN = /glass|acrylic|translucent/i

import { useCallback, useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import RoomCardSurface from './RoomCardSurface'
import { isPremiumRoomCardReady, selectBoundedRoomCards } from './roomCardMaterial'
import { displaySlotsFor, SURFACE_ASSETS, SURFACE_HOST_ASSETS } from './roomLayout'

function developmentProofTransform(item) {
  if (!import.meta.env.DEV) return null
  const params = new URLSearchParams(window.location.search)
  // When a fixture instance is requested, it must use the persisted stand's
  // actual slot transform.  The synthetic camera-facing proof transform is
  // useful for card-surface debugging only and would hide placement errors.
  if (Number(params.get('roomCardFixtureInstance') || 0)) return null
  if (Number(params.get('roomCardProof') || params.get('roomCardFixture')) !== Number(item.preview?.card_id)) return null
  const yaw = THREE.MathUtils.degToRad(Number(params.get('roomCardYaw') || 0))
  const tilt = THREE.MathUtils.degToRad(Number(params.get('roomCardTilt') || 0))
  // Keep the proof fixture in the initial spawn's forward view.  The previous
  // debug point was several metres to the player's left, so the authoritative
  // 2D reference could load while the 3D card was simply outside the camera
  // frustum.  This is dev-only and does not alter persisted stand placement.
  return { position: [3.06, 1.54, 3.18], rotation: [tilt, yaw, 0], distance: .26, scale: .9 }
}

function developmentStageTransform(item) {
  if (!import.meta.env.DEV) return null
  const params = new URLSearchParams(window.location.search)
  if (params.get('roomCardFixtureStage') !== 'compact') return null
  if (Number(params.get('roomCardFixture') || params.get('roomCardProof')) !== Number(item.preview?.card_id)) return null
  const slot = displaySlotsFor('card_display_stand_white')[0]
  const hostPosition = [3.06, 1.319, 3.18]
  const hostYaw = params.get('roomCardStageView') === 'display' ? Math.PI : 0
  const cosine = Math.cos(hostYaw)
  const sine = Math.sin(hostYaw)
  const hostRotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, hostYaw, 0))
  const localTilt = new THREE.Quaternion().setFromEuler(new THREE.Euler(slot.tilt, 0, 0))
  const rotation = new THREE.Euler().setFromQuaternion(hostRotation.multiply(localTilt))
  return {
    position: [hostPosition[0] + slot.x * cosine + slot.z * sine, hostPosition[1] + slot.y, hostPosition[2] - slot.x * sine + slot.z * cosine],
    rotation: [rotation.x, rotation.y, rotation.z], scale: slot.scale || 1, distance: 1.8, faceSide: 1,
  }
}

export function displayHostTransform(item, bootstrap) {
  const instanceId = Number(item.display_instance_id || item.copy?.location_ref)
  if (!instanceId) return null
  const placement = (bootstrap?.room?.placements || []).find(row => row.instance_id === instanceId)
  if (!placement) return null
  const instance = bootstrap?.owned_instances?.find(value => value.id === instanceId)
  const definition = (bootstrap?.catalog || []).find(value => value.id === instance?.definition_id)
  if (!definition || SURFACE_HOST_ASSETS.has(definition.asset_id) || !SURFACE_ASSETS.has(definition.asset_id)) return null
  const slots = displaySlotsFor(definition.asset_id)
  const slotIndex = item.slot_key === 'primary' ? 0 : Number.parseInt(item.slot_key, 10) || 0
  const slot = slots[slotIndex] || slots[0]
  const p = placement.transform?.position || {}
  const yaw = placement.transform?.rotation?.y || 0
  const cosine = Math.cos(yaw)
  const sine = Math.sin(yaw)
  // Apply the card's local stand tilt after orienting the stand.  Euler
  // [tilt, yaw, 0] tilts around world X, which turns cards sideways when a
  // placed stand is rotated.  The quaternion product preserves the stand's
  // local X axis for every yaw and keeps the face toward the stand front.
  // The authored stand opens toward local +Z. Keep the card face on that
  // same side; the placement yaw rotates both together.
  // The broad near panel is the back of the compact holder. Restore the
  // authored card yaw so its artwork faces outward from the far display side.
  const cardYaw = yaw + (slot.yaw || 0)
  const hostRotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, cardYaw, 0))
  const localTilt = new THREE.Quaternion().setFromEuler(new THREE.Euler(slot.tilt, 0, 0))
  const rotation = new THREE.Euler().setFromQuaternion(hostRotation.multiply(localTilt))
  return {
    position: [
      (p.x || 0) + slot.x * cosine + slot.z * sine,
      (p.y || 0) + slot.y,
      (p.z || 0) - slot.x * sine + slot.z * cosine,
    ],
    rotation: [rotation.x, rotation.y, rotation.z],
    scale: slot.scale || 1,
    distance: 1.8,
    faceSide: 1,
    flipHorizontal: definition.asset_id.startsWith('card_display_stand'),
    // RoomCardSurface positions the face at the negative of this value.  The
    // wide graded stand faces the card toward local -Z after its 180-degree
    // yaw, so its face plane must be on the positive local-Z side of the card
    // body.  The earlier default put the textured plane behind the dark card
    // body, leaving a black rectangle in every wide slot.  Compact stands use
    // their existing opposite-side placement and must remain untouched.
    facePlanePosition: definition.asset_id.startsWith('card_display_stand') ? null : -.0032,
  }
}

function transformFor(item, bootstrap) {
  const stage = developmentStageTransform(item)
  if (stage) return stage
  if (import.meta.env.DEV && item.dev_fixture) {
    const fixtureInstance = Number(new URLSearchParams(window.location.search).get('roomCardFixtureInstance') || 0)
    if (fixtureInstance) {
      // Explicitly prioritize the real persisted stand transform for the
      // placement probe.  This prevents the generic proof camera transform
      // from ever winning when both query switches are present.
      return displayHostTransform(item, bootstrap)
    }
  }
  const proof = developmentProofTransform(item)
  if (proof) return proof
  if (item.surface === 'display') return displayHostTransform(item, bootstrap)
  return null
}

function stablePhysicalOrder(items) {
  return [...items].sort((left, right) => String(left.copy?.id ?? '').localeCompare(String(right.copy?.id ?? ''), undefined, { numeric: true }))
}

export default function RoomCardCollection({ payload, bootstrap, quality = 'high', onVisibleCards }) {
  const items = useMemo(() => {
    const bounded = selectBoundedRoomCards(stablePhysicalOrder(payload?.items || []))
    if (!import.meta.env.DEV) return bounded
    const params = new URLSearchParams(window.location.search)
    const proofId = Number(params.get('roomCardProof') || params.get('roomCardFixture'))
    return proofId ? bounded.filter(item => Number(item.preview?.card_id) === proofId) : bounded
  }, [payload])
  const readyIds = useRef(new Set())
  useEffect(() => { readyIds.current = new Set(); onVisibleCards?.(0) }, [items, onVisibleCards])
  const markReady = useCallback(copyId => {
    readyIds.current.add(copyId)
    onVisibleCards?.(readyIds.current.size)
  }, [onVisibleCards])
  return <group name="authoritative-visible-physical-cards">
    {items.map(item => {
      if (item.surface !== 'display' && !item.dev_fixture) return null
      if (!item.card && !item.dev_fixture) return null
      const transform = transformFor(item, bootstrap)
      if (!transform) return null
      return <RoomCardSurface key={item.copy.id} item={item} {...transform} quality={quality} onTextureReady={() => markReady(item.copy.id)} />
    })}
  </group>
}

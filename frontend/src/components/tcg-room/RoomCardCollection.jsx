import { useCallback, useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import RoomCardSurface, { RoomCardPreparation } from './RoomCardSurface'
import { isPremiumRoomCardReady, selectBoundedRoomCards } from './roomCardMaterial'

function pileTransform(index) {
  const fan = index - 3.5
  return {
    position: [-4.98 + fan * .017, .91 + index * .0035, 2.55 + Math.abs(fan) * .006],
    rotation: [-Math.PI / 2, 0, Math.PI / 2 + fan * .045],
    distance: 3.8,
  }
}

function displayTransform(index) {
  const column = index % 6; const row = Math.floor(index / 6)
  return { position: [-3.72 + column * .52, 1.1 + row * .48, 3.94], rotation: [0, Math.PI, 0], distance: 2.6 }
}

function developmentProofTransform(item) {
  if (!import.meta.env.DEV) return null
  const params = new URLSearchParams(window.location.search)
  if (Number(params.get('roomCardProof') || params.get('roomCardFixture')) !== Number(item.preview?.card_id)) return null
  const yaw = THREE.MathUtils.degToRad(Number(params.get('roomCardYaw') || 0))
  const tilt = THREE.MathUtils.degToRad(Number(params.get('roomCardTilt') || 0))
  // Keep the DEV evidence card between the camera and room furnishings so a
  // bedpost or cabinet cannot invalidate the visual regression screenshot.
  return { position: [-1.1, 1.54, -.12], rotation: [tilt, yaw, 0], distance: .26, scale: .9 }
}

function transformFor(item, index, surfaceIndex) {
  const proof = developmentProofTransform(item)
  if (proof) return proof
  if (item.surface === 'carried') return { position: [0, 0, 0], rotation: [0, 0, 0], distance: .6 }
  if (item.surface === 'display') return displayTransform(surfaceIndex)
  return pileTransform(surfaceIndex)
}

function stablePhysicalOrder(items) {
  // The room bootstrap is polled while parcel/copy mutations settle. The API
  // is allowed to return equivalent rows in a different order; using that
  // order directly makes every pile/display card jump sideways on each poll.
  // Physical copies have durable ids, so use them as the visual ordering key.
  return [...items].sort((left, right) => {
    const surfaceOrder = { pile: 0, display: 1, carried: 2 }
    const leftSurface = surfaceOrder[left.surface] ?? 0
    const rightSurface = surfaceOrder[right.surface] ?? 0
    if (leftSurface !== rightSurface) return leftSurface - rightSurface
    return String(left.copy?.id ?? '').localeCompare(String(right.copy?.id ?? ''), undefined, { numeric: true })
  })
}

export default function RoomCardCollection({ payload, onVisibleCards }) {
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
  const counters = { pile: 0, display: 0, carried: 0 }
  return <group name="authoritative-visible-physical-cards">
    {items.map((item, index) => {
      const surfaceIndex = counters[item.surface]++
      const transform = transformFor(item, index, surfaceIndex)
      return isPremiumRoomCardReady(item)
        ? <RoomCardSurface key={item.copy.id} item={item} {...transform} onTextureReady={() => markReady(item.copy.id)} />
        : <RoomCardPreparation key={item.copy.id} item={item} {...transform} />
    })}
  </group>
}

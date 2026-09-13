import { useCallback, useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import RoomCardSurface from './RoomCardSurface'
import { isPremiumRoomCardReady, selectBoundedRoomCards } from './roomCardMaterial'
import { BLUE_BOXES } from './roomLayout'

function pileTransform(index) {
  const col = index % 3
  const row = Math.floor(index / 3)
  const origin = BLUE_BOXES.pile.position
  return {
    position: [origin[0] + (col - 1) * .07, origin[1] - .06 + row * .004, origin[2] + (index % 2) * .04],
    rotation: [-Math.PI / 2, 0, (col - 1) * .12],
    distance: 2.2,
  }
}

function developmentProofTransform(item) {
  if (!import.meta.env.DEV) return null
  const params = new URLSearchParams(window.location.search)
  if (Number(params.get('roomCardProof') || params.get('roomCardFixture')) !== Number(item.preview?.card_id)) return null
  const yaw = THREE.MathUtils.degToRad(Number(params.get('roomCardYaw') || 0))
  const tilt = THREE.MathUtils.degToRad(Number(params.get('roomCardTilt') || 0))
  return { position: [-1.1, 1.54, -.12], rotation: [tilt, yaw, 0], distance: .26, scale: .9 }
}

function displayHostTransform(item, bootstrap) {
  const instanceId = Number(item.copy?.location_ref)
  if (!instanceId) return null
  const placement = (bootstrap?.room?.placements || []).find(row => row.instance_id === instanceId)
  if (!placement) return null
  const p = placement.transform?.position || {}
  const r = placement.transform?.rotation || {}
  return {
    position: [p.x || 0, (p.y || 0) + .28, p.z || 0],
    rotation: [0, r.y || 0, 0],
    distance: 2.4,
  }
}

function transformFor(item, index, surfaceIndex, bootstrap) {
  const proof = developmentProofTransform(item)
  if (proof) return proof
  if (item.surface === 'carried') return { position: [0, 0, 0], rotation: [0, 0, 0], distance: .6 }
  if (item.surface === 'display') return displayHostTransform(item, bootstrap)
  return pileTransform(surfaceIndex)
}

function stablePhysicalOrder(items) {
  return [...items].sort((left, right) => {
    const surfaceOrder = { pile: 0, display: 1, carried: 2 }
    const leftSurface = surfaceOrder[left.surface] ?? 0
    const rightSurface = surfaceOrder[right.surface] ?? 0
    if (leftSurface !== rightSurface) return leftSurface - rightSurface
    return String(left.copy?.id ?? '').localeCompare(String(right.copy?.id ?? ''), undefined, { numeric: true })
  })
}

export default function RoomCardCollection({ payload, bootstrap, onVisibleCards }) {
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
      if (!isPremiumRoomCardReady(item) && !item.dev_fixture) return null
      const surfaceIndex = counters[item.surface]++
      const transform = transformFor(item, index, surfaceIndex, bootstrap)
      if (!transform) return null
      return <RoomCardSurface key={item.copy.id} item={item} {...transform} onTextureReady={() => markReady(item.copy.id)} />
    })}
  </group>
}

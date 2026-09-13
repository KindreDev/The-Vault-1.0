import { Suspense, useMemo } from 'react'
import { Canvas } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import { AuthoredBaseRoom, AuthoredFurnitureItems, MergedRoomAssets, PlacementGhost, VaultMonitorScreen } from './RoomAsset'
import FirstPersonController from './FirstPersonController'
import PlacementSession from './PlacementSession'
import RoomCardCollection from './RoomCardCollection'
import { AUTHORED_FURNITURE, AUTHORED_ROOM, BLUE_BOXES, COMPUTER_SCREEN } from './roomLayout'

function roomItemsForParcel(parcel) {
  if (!parcel || !['ready', 'collected', 'placed'].includes(parcel.status)) return []
  const count = Math.max(1, Math.min(6, parcel.contents?.reduce((sum, line) => sum + (line.quantity || 1), 0) || 1))
  const origin = BLUE_BOXES.inbox.position
  return Array.from({ length: count }, (_, index) => ({
    key: `parcel-${parcel.id}-${index}`,
    assetId: 'shipping_box_small',
    position: [origin[0] + (index % 3 - 1) * .08, origin[1] - .04, origin[2] + Math.floor(index / 3) * .08],
    rotation: [0, index * .35, 0],
    scale: .28,
    zone: 'entry',
    interactive: 'mail',
  }))
}

function interactionItemsForParcel(parcel) {
  return AUTHORED_ROOM.filter(item => item.interactive && !['parcel', 'parcel-place'].includes(item.interactive))
}

const interactionForType = type => ({ cabinet_slot: 'cabinet', display_stand: 'display', storage: null, acrylic_case: 'display', toploader: 'display', set_box: 'display' })[type] || null

function ownedRoomItems(bootstrap, activeInstanceId) {
  const definitions = new Map((bootstrap?.catalog || []).map(item => [item.id, item]))
  return (bootstrap?.room?.placements || []).filter(item => item.instance_id !== activeInstanceId).map(item => {
    const instance = bootstrap.owned_instances?.find(value => value.id === item.instance_id)
    const definition = definitions.get(instance?.definition_id)
    const position = item.transform?.position || {}
    const rotation = item.transform?.rotation || {}
    return definition?.asset_id ? {
      key: `owned-${item.instance_id}`,
      instanceId: item.instance_id,
      assetId: definition.asset_id,
      position: [position.x || 0, position.y || 0, position.z || 0],
      rotation: [rotation.x || 0, rotation.y || 0, rotation.z || 0],
      scale: 1,
      zone: 'owned',
      interactive: interactionForType(definition.type),
    } : null
  }).filter(Boolean)
}

function RoomLighting({ quality }) {
  return <>
    <color attach="background" args={['#d5e4ee']} />
    <hemisphereLight intensity={1.05} color="#fffaf0" groundColor="#8896a0" />
    <ambientLight intensity={.62} color="#fff7e8" />
    <directionalLight position={[-7, 5.5, 0]} intensity={1.45} color="#fff4dd" castShadow={quality === 'high'} shadow-mapSize-width={1024} shadow-mapSize-height={1024} shadow-camera-near={1} shadow-camera-far={28} shadow-camera-left={-8} shadow-camera-right={8} shadow-camera-top={8} shadow-camera-bottom={-8} />
    <directionalLight position={[0, 4.8, -7]} intensity={.45} color="#e7f1ff" />
    <pointLight position={[-.5, 2.7, 0]} intensity={.6} distance={14} decay={1.5} color="#fff4dd" />
  </>
}

export default function RoomScene(props) {
  const items = useMemo(() => [...roomItemsForParcel(props.parcel), ...ownedRoomItems(props.bootstrap, props.placementPreview?.instanceId)], [props.bootstrap, props.parcel, props.placementPreview?.instanceId])
  const authoredItems = useMemo(() => items.filter(item => AUTHORED_FURNITURE.has(item.assetId)), [items])
  const moduleItems = useMemo(() => items.filter(item => !AUTHORED_FURNITURE.has(item.assetId)), [items])
  const interactions = useMemo(() => [...interactionItemsForParcel(props.parcel), ...items.filter(item => item.zone === 'owned' && item.interactive)], [items, props.parcel])
  return <Canvas shadows={props.quality === 'high'} dpr={1} camera={{ fov: 66, near: .06, far: 50 }} gl={{ antialias: false, powerPreference: 'high-performance', stencil: false }} onCreated={({ gl }) => { gl.toneMappingExposure = 1.18 }}>
    <RoomLighting quality={props.quality} />
    <Suspense fallback={<Html center><div className="tcg-room__canvas-loader">Preparing your room...</div></Html>}>
      <AuthoredBaseRoom quality={props.quality} onLoaded={props.onLoaded} />
      {authoredItems.length > 0 && <AuthoredFurnitureItems version={props.version} items={authoredItems} quality={props.quality} />}
      {moduleItems.length > 0 && <MergedRoomAssets version={props.version} items={moduleItems} quality={props.quality} />}
      <VaultMonitorScreen position={COMPUTER_SCREEN.position} rotation={COMPUTER_SCREEN.rotation} size={COMPUTER_SCREEN.size} />
      {props.placementPreview && <PlacementGhost version={props.version} preview={props.placementPreview} />}
      <PlacementSession arranging={props.arranging} bootstrap={props.bootstrap} preview={props.placementPreview} followMouse={!props.placementPreview?.pinned} onHover={sample => props.onWorldSample?.({ kind: 'hover', ...sample })} onPlace={sample => props.onWorldSample?.({ kind: 'place', ...sample })} onRotate={yaw => props.onWorldSample?.({ kind: 'rotate', yaw, x: props.placementPreview?.transform?.position?.x, y: props.placementPreview?.transform?.position?.y, z: props.placementPreview?.transform?.position?.z })} onConfirm={props.onConfirmPlacement} onSelectInstance={props.onSelectPlaced} />
      <RoomCardCollection payload={props.visibleCards} bootstrap={props.bootstrap} onVisibleCards={props.onVisibleCards} />
    </Suspense>
    <FirstPersonController {...props} interactionItems={interactions} />
  </Canvas>
}

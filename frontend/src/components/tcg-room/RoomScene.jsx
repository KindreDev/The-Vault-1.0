import { Suspense, useMemo } from 'react'
import { Canvas } from '@react-three/fiber'
import { AuthoredBaseRoom, AuthoredFurnitureItems, DeliveredPacks, MergedRoomAssets, PlacementGhost, VaultMonitorScreen } from './RoomAsset'
import FirstPersonController from './FirstPersonController'
import PlacementSession from './PlacementSession'
import RoomCardCollection, { displayHostTransform } from './RoomCardCollection'
import RoomPosterDisplays from './RoomPosterDisplays'
import { AUTHORED_FURNITURE, AUTHORED_ROOM, COMPUTER_SCREEN, SURFACE_ASSETS, standMeshScale } from './roomLayout'
import { roomQualityProfile } from './roomQuality'

function interactionItems() {
  return AUTHORED_ROOM.filter(item => item.interactive && !['parcel', 'parcel-place'].includes(item.interactive))
}

function interactionForType(definition) {
  if (!definition) return null
  if (definition.asset_id === 'poster_frame') return 'poster'
  if (SURFACE_ASSETS.has(definition.asset_id)) return 'display'
  return null
}

function cardInteractionItems(visibleCards, bootstrap) {
  return (visibleCards?.items || []).map(item => {
    const transform = displayHostTransform(item, bootstrap)
    if (!transform || !item.card) return null
    return {
      key: `inspect-${item.copy?.id || item.preview?.card_id}`,
      interactive: 'card-inspect',
      position: transform.position,
      card: item.card,
      copy: ['Inspect card', 'Hold this card to appreciate its foil and effects'],
    }
  }).filter(Boolean)
}

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
      scale: standMeshScale(definition.asset_id),
      zone: 'owned',
      interactive: interactionForType(definition),
    } : null
  }).filter(Boolean)
}

function RoomLighting({ quality }) {
  const profile = roomQualityProfile(quality)
  return <>
    <color attach="background" args={['#d5e4ee']} />
    <hemisphereLight intensity={1.05} color="#fffaf0" groundColor="#8896a0" />
    <ambientLight intensity={.62} color="#fff7e8" />
    <directionalLight position={[-7, 5.5, 0]} intensity={1.45} color="#fff4dd" castShadow={profile.shadows} shadow-mapSize-width={1024} shadow-mapSize-height={1024} shadow-camera-near={1} shadow-camera-far={28} shadow-camera-left={-8} shadow-camera-right={8} shadow-camera-top={8} shadow-camera-bottom={-8} />
    <directionalLight position={[0, 4.8, -7]} intensity={.45} color="#e7f1ff" />
    <pointLight position={[-.5, 2.7, 0]} intensity={.6} distance={14} decay={1.5} color="#fff4dd" />
  </>
}

export default function RoomScene(props) {
  const profile = roomQualityProfile(props.quality)
  const items = useMemo(() => ownedRoomItems(props.bootstrap, props.placementPreview?.instanceId), [props.bootstrap, props.placementPreview?.instanceId])
  const authoredItems = useMemo(() => items.filter(item => AUTHORED_FURNITURE.has(item.assetId)), [items])
  const moduleItems = useMemo(() => items.filter(item => !AUTHORED_FURNITURE.has(item.assetId)), [items])
  const stagingStand = useMemo(() => {
    if (!import.meta.env.DEV || new URLSearchParams(window.location.search).get('roomCardFixtureStage') !== 'compact') return []
    const view = new URLSearchParams(window.location.search).get('roomCardStageView')
    return [{ key: 'dev-compact-fixture-stand', assetId: 'card_display_stand_white', position: [3.06, 1.319, 3.18], rotation: [0, view === 'display' ? Math.PI : 0, 0], scale: standMeshScale('card_display_stand_white'), zone: 'dev' }]
  }, [])
  const interactions = useMemo(() => [
    ...interactionItems(),
    ...items.filter(item => item.zone === 'owned' && item.interactive),
    ...cardInteractionItems(props.visibleCards, props.bootstrap),
  ], [items, props.bootstrap, props.visibleCards])
  return <Canvas shadows={profile.shadows} dpr={profile.dpr} camera={{ fov: 66, near: .06, far: 50 }} gl={{ antialias: false, powerPreference: 'high-performance', stencil: false }} onCreated={({ gl }) => { gl.toneMappingExposure = 1.18 }}>
    <RoomLighting quality={props.quality} />
    <Suspense fallback={null}>
      <AuthoredBaseRoom quality={props.quality} onLoaded={props.onLoaded} />
      {authoredItems.length > 0 && <AuthoredFurnitureItems version={props.version} items={authoredItems} quality={props.quality} />}
      {stagingStand.length > 0 && <AuthoredFurnitureItems version={props.version} items={stagingStand} quality={props.quality} />}
      {moduleItems.length > 0 && <MergedRoomAssets version={props.version} items={moduleItems} quality={props.quality} />}
      {props.parcels?.length ? <DeliveredPacks version={props.version} parcel={props.parcels} /> : props.parcel && <DeliveredPacks version={props.version} parcel={props.parcel} />}
      <VaultMonitorScreen position={COMPUTER_SCREEN.position} rotation={COMPUTER_SCREEN.rotation} size={COMPUTER_SCREEN.size} />
      {props.placementPreview && <PlacementGhost version={props.version} preview={props.placementPreview} />}
    </Suspense>
    <PlacementSession arranging={props.arranging} bootstrap={props.bootstrap} preview={props.placementPreview} onHover={sample => props.onWorldSample?.({ kind: 'hover', ...sample })} onRotate={yaw => props.onWorldSample?.({ kind: 'rotate', yaw })} onConfirm={props.onConfirmPlacement} onSelectInstance={props.onSelectPlaced} />
    <Suspense fallback={null}>
      <RoomCardCollection payload={props.visibleCards} bootstrap={props.bootstrap} quality={profile.key} onVisibleCards={props.onVisibleCards} />
    </Suspense>
    <RoomPosterDisplays bootstrap={props.bootstrap} />
    <FirstPersonController {...props} interactionItems={interactions} />
  </Canvas>
}

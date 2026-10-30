import { Suspense, useMemo } from 'react'
import { Canvas } from '@react-three/fiber'
import { AuthoredBaseRoom, AuthoredFurnitureItems, DeliveredPacks, MergedRoomAssets, ShelvedPacks, VaultMonitorScreen } from './RoomAsset'
import { PlacementFloorGrid, PlacementGhost } from './RoomPlacementVisuals'
import RoomLighting, { installRoomEnvironment } from './RoomLighting'
import FirstPersonController from './FirstPersonController'
import PlacementSession from './PlacementSession'
import PlacementContextOverlay from './PlacementContextOverlay'
import RoomCardCollection, { displayHostTransform } from './RoomCardCollection'
import RoomPosterDisplays from './RoomPosterDisplays'
import RoomMediaFurniture from './RoomMediaFurniture'
import { AUTHORED_FURNITURE, AUTHORED_ROOM, CARD_HOLDER_ASSETS, COMPUTER_SCREEN, LED_DEFAULTS, POSTER_ASSETS, SCREEN_FRAMES, SURFACE_ASSETS, WALL_BASE_ORIGIN_ASSETS, standMeshScale } from './roomLayout'
import { roomQualityProfile } from './roomQuality'

function interactionItems() {
  return AUTHORED_ROOM.filter(item => item.interactive && !['parcel', 'parcel-place'].includes(item.interactive))
}

function interactionForType(definition) {
  if (!definition) return null
  if (POSTER_ASSETS.has(definition.asset_id)) return 'poster'
  if (CARD_HOLDER_ASSETS.has(definition.asset_id)) return 'display'
  if (SCREEN_FRAMES[definition.asset_id]) return 'screen'
  if (definition.asset_id === 'binder_lectern') return 'lectern'
  if (definition.asset_id === 'poster_flip_bin') return 'flipbin'
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
      // The pedestal ring's authored glow clips to white, so it always takes
      // the tint path (which caps its brightness) even before a colour is set.
      ledColor: item.transform?.content?.led_color || (definition.asset_id === 'rotating_pedestal' ? LED_DEFAULTS.rotating_pedestal : null),
      // Wall pieces hang from their bottom edge; aim the prompt at their middle.
      interactionY: WALL_BASE_ORIGIN_ASSETS.has(definition.asset_id) ? (position.y || 0) + Number(definition.footprint?.height || 0) / 2 : null,
    } : null
  }).filter(Boolean)
}

// Floor furniture the player should walk around, as world-space XZ boxes.
function furnitureObstacles(bootstrap) {
  const definitions = new Map((bootstrap?.catalog || []).map(item => [item.id, item]))
  return (bootstrap?.room?.placements || []).map(row => {
    const instance = bootstrap.owned_instances?.find(value => value.id === row.instance_id)
    const definition = definitions.get(instance?.definition_id)
    if (!definition || SURFACE_ASSETS.has(definition.asset_id)) return null
    const footprint = definition.footprint || {}
    const position = row.transform?.position || {}
    const height = Number(footprint.height || .5)
    const base = definition.placement_kind === 'wall' && !WALL_BASE_ORIGIN_ASSETS.has(definition.asset_id) ? (position.y || 0) - height / 2 : (position.y || 0)
    // Wall art above head height or thin wall decor never blocks walking.
    if (definition.placement_kind === 'wall' && (base > 1.6 || Number(footprint.depth || 0) < .12)) return null
    const yaw = row.transform?.rotation?.y || 0
    const cosine = Math.abs(Math.cos(yaw))
    const sine = Math.abs(Math.sin(yaw))
    const width = cosine * (footprint.width || .5) + sine * (footprint.depth || .5)
    const depth = sine * (footprint.width || .5) + cosine * (footprint.depth || .5)
    return { min: [(position.x || 0) - width / 2, (position.z || 0) - depth / 2], max: [(position.x || 0) + width / 2, (position.z || 0) + depth / 2] }
  }).filter(Boolean)
}

export default function RoomScene(props) {
  const profile = roomQualityProfile(props.quality)
  // Bootstrap refetches create new objects even when the furniture is
  // unchanged (parcel timers, counters).  Key the furniture on its content so
  // the merged room geometry is only rebuilt when the layout really changes.
  const freshItems = useMemo(() => ownedRoomItems(props.bootstrap, props.placementPreview?.instanceId), [props.bootstrap, props.placementPreview?.instanceId])
  const itemsKey = JSON.stringify(freshItems)
  const items = useMemo(() => freshItems, [itemsKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const obstacleKey = JSON.stringify(furnitureObstacles(props.bootstrap))
  const obstacles = useMemo(() => JSON.parse(obstacleKey), [obstacleKey])
  const shadowToken = `${itemsKey.length}:${itemsKey}:${props.visibleCards?.items?.length || 0}:${props.parcels?.length || 0}`
  const authoredItems = useMemo(() => items.filter(item => AUTHORED_FURNITURE.has(item.assetId)), [items])
  const moduleItems = useMemo(() => items.filter(item => !AUTHORED_FURNITURE.has(item.assetId)), [items])
  const packShelves = useMemo(() => items.filter(item => item.assetId === 'pack_shelf'), [items])
  const stagingStand = useMemo(() => {
    if (!import.meta.env.DEV || new URLSearchParams(window.location.search).get('roomCardFixtureStage') !== 'compact') return []
    const view = new URLSearchParams(window.location.search).get('roomCardStageView')
    return [{ key: 'dev-compact-fixture-stand', assetId: 'card_display_stand_white', position: [3.06, 1.319, 3.18], rotation: [0, view === 'display' ? Math.PI : 0, 0], scale: standMeshScale('card_display_stand_white'), zone: 'dev' }]
  }, [])
  const interactions = useMemo(() => [
    ...interactionItems(),
    ...items.filter(item => item.zone === 'owned' && item.interactive)
      .map(item => item.interactionY == null ? item : { ...item, position: [item.position[0], item.interactionY, item.position[2]] }),
    ...cardInteractionItems(props.visibleCards, props.bootstrap),
  ], [items, props.bootstrap, props.visibleCards])
  const floorPreview = props.placementPreview?.definition?.placement_kind === 'floor' && !SURFACE_ASSETS.has(props.placementPreview.assetId)
  // Antialiasing is fixed when the WebGL context is created, so a quality
  // change remounts the canvas (assets stay cached).  Full-screen panels
  // (trader, inventory) cover the room, so it only redraws on demand there.
  return <Canvas key={profile.key} className="tcg-room__scene-canvas" frameloop={props.renderOnDemand ? 'demand' : 'always'} shadows={profile.shadows ? (profile.key === 'high' ? 'soft' : true) : false} dpr={profile.dpr} camera={{ fov: 66, near: .06, far: 50 }} gl={{ antialias: profile.antialias, powerPreference: 'high-performance', stencil: false }} onCreated={state => { installRoomEnvironment(state.gl, state.scene); if (import.meta.env.DEV) window.__vaultRoom = state }}>
    <RoomLighting quality={props.quality} lighting={props.lighting} shadowToken={shadowToken} />
    <Suspense fallback={null}>
      <AuthoredBaseRoom quality={props.quality} onLoaded={props.onLoaded} />
      {authoredItems.length > 0 && <AuthoredFurnitureItems version={props.version} items={authoredItems} quality={props.quality} />}
      {stagingStand.length > 0 && <AuthoredFurnitureItems version={props.version} items={stagingStand} quality={props.quality} />}
      {moduleItems.length > 0 && <MergedRoomAssets version={props.version} items={moduleItems} quality={props.quality} />}
      {props.parcels?.length ? <DeliveredPacks version={props.version} parcel={props.parcels} /> : props.parcel && <DeliveredPacks version={props.version} parcel={props.parcel} />}
      {/* Own boundary: pack art loads after the room, never holding it up. */}
      {packShelves.length > 0 && props.sealedPacks?.length > 0 && <Suspense fallback={null}><ShelvedPacks shelves={packShelves} packs={props.sealedPacks} /></Suspense>}
      <VaultMonitorScreen position={COMPUTER_SCREEN.position} rotation={COMPUTER_SCREEN.rotation} size={COMPUTER_SCREEN.size} />
      {props.placementPreview && <PlacementGhost key={props.placementPreview.instanceId} version={props.version} preview={props.placementPreview} />}
      {props.arranging && floorPreview && <PlacementFloorGrid preview={props.placementPreview} />}
      {props.placementPreview && <PlacementContextOverlay preview={props.placementPreview} />}
    </Suspense>
    <PlacementSession arranging={props.arranging} bootstrap={props.bootstrap} preview={props.placementPreview} onHover={sample => props.onWorldSample?.({ kind: 'hover', ...sample })} onRotate={yaw => props.onWorldSample?.({ kind: 'rotate', yaw })} onLock={props.onLockPlacement} onSelectInstance={props.onSelectPlaced} onDeselect={props.onDeselectPlacement} />
    <Suspense fallback={null}>
      <RoomCardCollection payload={props.visibleCards} bootstrap={props.bootstrap} quality={profile.key} onVisibleCards={props.onVisibleCards} />
    </Suspense>
    <RoomPosterDisplays bootstrap={props.bootstrap} activeInstanceId={props.placementPreview?.instanceId} />
    <Suspense fallback={null}>
      <RoomMediaFurniture bootstrap={props.bootstrap} activeInstanceId={props.placementPreview?.instanceId} quality={profile.key} />
    </Suspense>
    <FirstPersonController {...props} obstacles={obstacles} interactionItems={interactions} />
  </Canvas>
}

import { Suspense, useMemo } from 'react'
import { Canvas } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import { MergedRoomAssets, PlacementGhost } from './RoomAsset'
import FirstPersonController from './FirstPersonController'
import RoomCardCollection from './RoomCardCollection'
import { AUTHORED_ROOM, PARCEL_SURFACES } from './roomLayout'

function roomItemsForParcel(parcel) {
  const items = AUTHORED_ROOM.filter(item => !['shipping_box_small', 'padded_mailer'].includes(item.assetId))
  if (!parcel || !['ready', 'placed'].includes(parcel.status)) return items
  const ready = parcel.status === 'ready'
  const position = ready ? [-5.35, .13, .55] : (PARCEL_SURFACES[parcel.placement?.snap_anchor] || PARCEL_SURFACES.sorting_mat)
  return [...items, { key: `parcel-${parcel.id}-${parcel.status}`, assetId: 'shipping_box_small', position, rotation: [0, Math.PI / 2, 0], scale: 1, zone: 'entry', interactive: ready ? 'mail' : 'parcel' }]
}

function interactionItemsForParcel(parcel) {
  const base = AUTHORED_ROOM.filter(item => item.interactive && !['parcel', 'parcel-place'].includes(item.interactive))
  if (parcel?.status === 'collected') return [...base, ...Object.entries(PARCEL_SURFACES).map(([anchor, position]) => ({ key: `parcel-place-${anchor}`, position, interactive: 'parcel-place', parcelAnchor: anchor }))]
  if (parcel?.status === 'placed') return [...base, { key: `parcel-open-${parcel.id}`, position: PARCEL_SURFACES[parcel.placement?.snap_anchor] || PARCEL_SURFACES.sorting_mat, interactive: 'parcel' }]
  return base
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
    <color attach="background" args={['#dce8ef']} />
    <hemisphereLight intensity={1.05} color="#fffaf0" groundColor="#8896a0" />
    <ambientLight intensity={.72} color="#fff7e8" />
    <directionalLight position={[-3, 7, 5]} intensity={1.7} color="#fff4dd" castShadow={quality === 'high'} shadow-mapSize-width={1024} shadow-mapSize-height={1024} shadow-camera-near={1} shadow-camera-far={20} shadow-camera-left={-7} shadow-camera-right={7} shadow-camera-top={6} shadow-camera-bottom={-6} />
    <pointLight position={[0, 2.85, 0]} intensity={.55} distance={13} decay={1.5} color="#fff4dd" />
  </>
}

export default function RoomScene(props) {
  const items = useMemo(() => [...roomItemsForParcel(props.parcel), ...ownedRoomItems(props.bootstrap, props.placementPreview?.instanceId)], [props.bootstrap, props.parcel, props.placementPreview?.instanceId])
  const interactions = useMemo(() => [...interactionItemsForParcel(props.parcel), ...items.filter(item => item.zone === 'owned' && item.interactive)], [items, props.parcel])
  return <Canvas shadows={props.quality === 'high'} dpr={1} camera={{ fov: 66, near: .06, far: 40 }} gl={{ antialias: false, powerPreference: 'high-performance', stencil: false }} onCreated={({ gl }) => { gl.toneMappingExposure = 1.18 }}>
    <RoomLighting quality={props.quality} />
    <Suspense fallback={<Html center><div className="tcg-room__canvas-loader">Preparing your room...</div></Html>}>
      <MergedRoomAssets version={props.version} items={items} quality={props.quality} onLoaded={props.onLoaded} />
      {props.placementPreview && <PlacementGhost version={props.version} preview={props.placementPreview} />}
      <RoomCardCollection payload={props.visibleCards} onVisibleCards={props.onVisibleCards} />
    </Suspense>
    <FirstPersonController {...props} interactionItems={interactions} />
  </Canvas>
}

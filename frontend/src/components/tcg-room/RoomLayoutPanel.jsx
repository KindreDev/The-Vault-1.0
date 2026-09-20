import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Redo2, Undo2, X } from 'lucide-react'
import { tcgRoomApi } from '../../lib/api'
import { AUTHORED_SURFACES, COLLISION_BOXES, FLOOR_Y, PLACEMENT_BOUNDS, ROOM_SIZE, SURFACE_ASSETS, SURFACE_HOST_ASSETS } from './roomLayout'

const point = (x = 0, y = 0, z = 0) => ({ x, y, z })
const transform = (position = point(), rotation = point()) => ({ position, rotation })
const round = value => Math.round(value * 1000) / 1000

function defaultTransform(definition) {
  return definition?.placement_kind === 'wall'
    ? transform(point(0, 1.5, PLACEMENT_BOUNDS.floor.minZ), point(0, 0, 0))
    : transform(point(0, FLOOR_Y, 0), point())
}

function placementBox(definition, value) {
  const footprint = definition?.footprint || { width: .5, depth: .5 }
  const yaw = value.rotation?.y || 0
  const cosine = Math.abs(Math.cos(yaw))
  const sine = Math.abs(Math.sin(yaw))
  const width = cosine * (footprint.width || .5) + sine * (footprint.depth || .5)
  const depth = sine * (footprint.width || .5) + cosine * (footprint.depth || .5)
  return { minX: value.position.x - width / 2, maxX: value.position.x + width / 2, minZ: value.position.z - depth / 2, maxZ: value.position.z + depth / 2 }
}

const overlaps = (a, b) => a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ
const wallPlane = position => {
  const bounds = PLACEMENT_BOUNDS.floor
  const distances = { west: Math.abs(position.x - bounds.minX), east: Math.abs(position.x - bounds.maxX), north: Math.abs(position.z - bounds.minZ), south: Math.abs(position.z - bounds.maxZ) }
  return Object.entries(distances).sort((a, b) => a[1] - b[1])[0][0]
}

function wallBox(definition, value) {
  const box = placementBox(definition, value)
  const plane = wallPlane(value.position)
  const height = Math.max(.05, definition?.footprint?.height || .5)
  return {
    plane,
    tangentMin: plane === 'north' || plane === 'south' ? box.minX : box.minZ,
    tangentMax: plane === 'north' || plane === 'south' ? box.maxX : box.maxZ,
    verticalMin: value.position.y - height / 2,
    verticalMax: value.position.y + height / 2,
  }
}

const wallOverlaps = (a, b) => a.plane === b.plane && a.tangentMin < b.tangentMax && a.tangentMax > b.tangentMin && a.verticalMin < b.verticalMax && a.verticalMax > b.verticalMin

function surfaceHosts(placed, definitions, instances) {
  const hosts = AUTHORED_SURFACES.map(host => ({ ...host }))
  for (const row of placed) {
    const instance = instances.find(item => item.id === row.instance_id)
    const other = definitions.get(instance?.definition_id)
    if (!other || !SURFACE_HOST_ASSETS.has(other.asset_id)) continue
    const box = placementBox(other, row.transform)
    const height = other.footprint?.height || .5
    hosts.push({ minX: box.minX, maxX: box.maxX, minZ: box.minZ, maxZ: box.maxZ, top: (row.transform?.position?.y || 0) + height })
  }
  return hosts
}

function validate(definition, value, placed, definitions, instances, selectedId) {
  const { position } = value
  if (definition?.placement_kind === 'wall') {
    const bounds = PLACEMENT_BOUNDS.wall
    if (position.y < PLACEMENT_BOUNDS.wallY.min || position.y > PLACEMENT_BOUNDS.wallY.max) return 'Keep it on the wall'
    if (position.x < bounds.minX || position.x > bounds.maxX || position.z < bounds.minZ || position.z > bounds.maxZ) return 'Keep the item inside the room'
    const box = wallBox(definition, value)
    if (box.verticalMin < 0 || box.verticalMax > ROOM_SIZE.height) return 'Keep the whole item within the wall height'
    if (box.plane === 'north' && box.verticalMin < 2.55 && box.verticalMax > .35 && box.tangentMin < 1.25 && box.tangentMax > -1.25) return 'This would cover a window'
    if (box.plane === 'west' && box.verticalMin < 2.55 && box.verticalMax > .35 && box.tangentMin < 1.25 && box.tangentMax > -1.25) return 'This would cover a window'
    if (box.plane === 'south' && box.verticalMin < 2.7 && box.verticalMax > 0 && box.tangentMin < 3.95 && box.tangentMax > 2.15) return 'This would cover the door'
    for (const row of placed) {
      if (row.instance_id === selectedId) continue
      const instance = instances.find(item => item.id === row.instance_id)
      const other = definitions.get(instance?.definition_id)
      if (other?.placement_kind === 'wall' && wallOverlaps(box, wallBox(other, row.transform))) return 'This overlaps another wall item'
    }
    return null
  }
  const box = placementBox(definition, value)
  const bounds = PLACEMENT_BOUNDS.floor
  if (box.minX < bounds.minX || box.maxX > bounds.maxX || box.minZ < bounds.minZ || box.maxZ > bounds.maxZ) return 'Keep the whole item inside the room'
  if (SURFACE_ASSETS.has(definition?.asset_id)) {
    const host = surfaceHosts(placed, definitions, instances).find(item => position.x >= item.minX && position.x <= item.maxX && position.z >= item.minZ && position.z <= item.maxZ)
    if (!host) return 'Place this on a table, desk, stand, or counter — not the floor'
    return null
  }
  const safetyBoxes = COLLISION_BOXES
  if (safetyBoxes.some(block => overlaps(box, { minX: block.min[0], maxX: block.max[0], minZ: block.min[1], maxZ: block.max[1] }))) return 'This overlaps permanent furniture or a clear walkway'
  for (const row of placed) {
    if (row.instance_id === selectedId) continue
    const instance = instances.find(item => item.id === row.instance_id)
    const other = definitions.get(instance?.definition_id)
    if (other?.placement_kind === 'floor' && !SURFACE_ASSETS.has(other.asset_id) && overlaps(box, placementBox(other, row.transform))) return 'This overlaps another placed item'
  }
  return null
}

export default function RoomLayoutPanel({ bootstrap, onPreview, initialInstanceId = null, worldSample = null, onConfirmReady, onExit }) {
  const qc = useQueryClient()
  const room = bootstrap?.room || { revision: 0, placements: [] }
  const definitions = useMemo(() => new Map((bootstrap?.catalog || []).filter(item => item.asset_id && ['floor', 'wall'].includes(item.placement_kind)).map(item => [item.id, item])), [bootstrap])
  const instances = useMemo(() => (bootstrap?.owned_instances || []).filter(item => definitions.has(item.definition_id)), [bootstrap, definitions])
  const [selectedId, setSelectedId] = useState(null)
  const [draft, setDraft] = useState(null)
  const [pinned, setPinned] = useState(false)
  const lastInitialId = useRef(null)
  const commitRef = useRef(null)
  const selected = instances.find(item => item.id === selectedId)
  const definition = definitions.get(selected?.definition_id)
  const placed = room.placements || []
  const existing = placed.find(item => item.instance_id === selectedId)
  const invalid = draft ? validate(definition, draft, placed, definitions, instances, selectedId) : null

  useEffect(() => { onPreview?.(draft && definition ? { instanceId: selectedId, assetId: definition.asset_id, transform: draft, valid: !invalid, definition, pinned } : null) }, [definition, draft, invalid, onPreview, pinned, selectedId])
  useEffect(() => () => onPreview?.(null), [onPreview])

  const select = useCallback(instance => {
    const saved = placed.find(item => item.instance_id === instance.id)?.transform
    setSelectedId(instance.id)
    setPinned(Boolean(saved))
    setDraft(saved || defaultTransform(definitions.get(instance.definition_id)))
  }, [definitions, placed])
  useEffect(() => {
    if (!worldSample || !selectedId || !definition) return
    if (worldSample.kind === 'rotate') {
      setDraft(current => current && transform(current.position, point(0, round(worldSample.yaw), 0)))
      return
    }
    const y = definition.placement_kind === 'wall' || SURFACE_ASSETS.has(definition.asset_id) ? worldSample.y : FLOOR_Y
    setDraft(transform(point(round(worldSample.x), round(y), round(worldSample.z)), point(0, round(worldSample.yaw || 0), 0)))
    setPinned(false)
  }, [definition, selectedId, worldSample])
  useEffect(() => {
    if (initialInstanceId == null || lastInitialId.current === initialInstanceId) return
    if (selectedId) return
    lastInitialId.current = initialInstanceId
    const instance = instances.find(item => item.id === initialInstanceId)
    if (instance) select(instance)
  }, [initialInstanceId, instances, select, selectedId])
  const finish = () => { setSelectedId(null); setDraft(null); setPinned(false); onPreview?.(null) }
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ['tcg-room-bootstrap'] }), qc.invalidateQueries({ queryKey: ['tcg-room-furniture'] })])
  const handleError = error => { if (error.response?.status === 409) { finish(); refresh(); toast.error('The room changed elsewhere. Latest layout loaded; choose the item again.') } else toast.error(error.response?.data?.detail || 'Could not update the room') }
  const commit = useMutation({
    mutationFn: () => existing ? tcgRoomApi.moveFurniture(selectedId, { expected_revision: room.revision, transform: draft, snap_anchor: definition.placement_kind }) : tcgRoomApi.placeFurniture(selectedId, { expected_revision: room.revision, transform: draft, snap_anchor: definition.placement_kind }),
    onSuccess: () => { finish(); refresh(); toast.success(existing ? 'Furniture moved' : 'Furniture placed') }, onError: handleError,
  })
  commitRef.current = { commit, invalid, draft }
  useEffect(() => {
    onConfirmReady?.(() => {
      const current = commitRef.current
      if (!current?.draft || current.invalid) return
      current.commit.mutate()
    })
  }, [onConfirmReady])
  const storeItem = useMutation({ mutationFn: id => tcgRoomApi.returnFurniture(id, room.revision), onSuccess: () => { finish(); refresh(); toast.success('Returned to Furniture Inventory') }, onError: handleError })
  const history = useMutation({ mutationFn: kind => kind === 'undo' ? tcgRoomApi.undoLayout(room.revision) : tcgRoomApi.redoLayout(room.revision), onSuccess: () => { finish(); refresh(); toast.success('Layout updated') }, onError: handleError })

  return <div className="placement-mode placement-mode--live">
    <header><div><span>PLACEMENT MODE</span><strong>{definition?.name || 'Look where it should go'}</strong><small>WASD to move · hold right mouse to look · item follows the cursor · Q/E or wheel to rotate · left click to place</small></div><button disabled={history.isPending} onClick={() => history.mutate('undo')}><Undo2 size={18} /> Undo</button><button disabled={history.isPending} onClick={() => history.mutate('redo')}><Redo2 size={18} /> Redo</button><button onClick={onExit}><X size={18} /> Done</button></header>
    <div className="placement-mode__strip">{instances.map(instance => {
      const itemDefinition = definitions.get(instance.definition_id)
      return <button key={instance.id} className={`${instance.id === selectedId ? 'selected' : ''} ${instance.status === 'placed' ? 'placed' : ''}`} onClick={() => select(instance)}><span>{itemDefinition?.name || `Room item ${instance.id}`}</span><b>{instance.status === 'placed' ? 'Placed' : 'Ready'}</b></button>
    })}</div>
    {draft && <div className={`placement-mode__status ${invalid ? 'invalid' : 'valid'}`}><strong>{invalid || 'Left click to place it'}</strong>{existing && <button className="danger" disabled={storeItem.isPending} onClick={() => storeItem.mutate(selectedId)}>Return to inventory</button>}<button onClick={finish}><X /> Cancel</button></div>}
  </div>
}

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Check, PackageOpen, Redo2, RotateCcw, RotateCw, Undo2, X } from 'lucide-react'
import { tcgRoomApi } from '../../lib/api'
import { COLLISION_BOXES, PLACEMENT_BOUNDS, ROOM_SIZE } from './roomLayout'

const STEP = .25
const TURN = Math.PI / 12
const point = (x = 0, y = 0, z = 0) => ({ x, y, z })
const transform = (position = point(), rotation = point()) => ({ position, rotation })
const round = value => Math.round(value * 1000) / 1000

function defaultTransform(definition) {
  return definition?.placement_kind === 'wall'
    ? transform(point(0, 1.5, PLACEMENT_BOUNDS.floor.maxZ), point(0, Math.PI, 0))
    : transform(point(0, 0, 0), point())
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

function validate(definition, value, placed, definitions, instances, selectedId) {
  const { position } = value
  if (definition?.placement_kind === 'wall') {
    const nearNorth = Math.abs(position.z - PLACEMENT_BOUNDS.floor.maxZ) < .08
    const nearSouth = Math.abs(position.z - PLACEMENT_BOUNDS.floor.minZ) < .08
    const nearEast = Math.abs(position.x - PLACEMENT_BOUNDS.floor.maxX) < .08
    const nearWest = Math.abs(position.x - PLACEMENT_BOUNDS.floor.minX) < .08
    if (!(nearNorth || nearSouth || nearEast || nearWest)) return 'Wall items must touch a wall'
    const box = wallBox(definition, value)
    const tangentLimit = box.plane === 'north' || box.plane === 'south' ? [PLACEMENT_BOUNDS.floor.minX, PLACEMENT_BOUNDS.floor.maxX] : [PLACEMENT_BOUNDS.floor.minZ, PLACEMENT_BOUNDS.floor.maxZ]
    if (box.verticalMin < 0 || box.verticalMax > ROOM_SIZE.height) return 'Keep the whole item within the wall height'
    if (box.tangentMin < tangentLimit[0] || box.tangentMax > tangentLimit[1]) return 'Keep the whole item within the wall edges'
    if (box.plane === 'south' && box.verticalMin < 2.55 && box.verticalMax > .35 && [[-4.55, -1.72], [1.72, 4.55]].some(([min, max]) => box.tangentMin < max && box.tangentMax > min)) return 'This would cover a window'
    if (box.plane === 'west' && box.verticalMin < 2.5 && box.verticalMax > 0 && box.tangentMin < .9 && box.tangentMax > -.9) return 'This would cover the door'
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
  const safetyBoxes = [...COLLISION_BOXES, { min: [-5.55, -1.5], max: [-4.45, 1.5] }]
  if (safetyBoxes.some(block => overlaps(box, { minX: block.min[0], maxX: block.max[0], minZ: block.min[1], maxZ: block.max[1] }))) return 'This overlaps permanent furniture or a clear walkway'
  for (const row of placed) {
    if (row.instance_id === selectedId) continue
    const instance = instances.find(item => item.id === row.instance_id)
    const other = definitions.get(instance?.definition_id)
    if (other?.placement_kind === 'floor' && overlaps(box, placementBox(other, row.transform))) return 'This overlaps another placed item'
  }
  return null
}

export default function RoomLayoutPanel({ bootstrap, onPreview }) {
  const qc = useQueryClient()
  const room = bootstrap?.room || { revision: 0, placements: [] }
  const definitions = useMemo(() => new Map((bootstrap?.catalog || []).filter(item => item.asset_id && ['floor', 'wall'].includes(item.placement_kind)).map(item => [item.id, item])), [bootstrap])
  const instances = useMemo(() => (bootstrap?.owned_instances || []).filter(item => definitions.has(item.definition_id)), [bootstrap, definitions])
  const [selectedId, setSelectedId] = useState(null)
  const [draft, setDraft] = useState(null)
  const selected = instances.find(item => item.id === selectedId)
  const definition = definitions.get(selected?.definition_id)
  const placed = room.placements || []
  const existing = placed.find(item => item.instance_id === selectedId)
  const invalid = draft ? validate(definition, draft, placed, definitions, instances, selectedId) : null

  useEffect(() => { onPreview?.(draft && definition ? { instanceId: selectedId, assetId: definition.asset_id, transform: draft, valid: !invalid, definition } : null) }, [definition, draft, invalid, onPreview, selectedId])
  useEffect(() => () => onPreview?.(null), [onPreview])

  const select = useCallback(instance => {
    const saved = placed.find(item => item.instance_id === instance.id)?.transform
    setSelectedId(instance.id); setDraft(saved || defaultTransform(definitions.get(instance.definition_id)))
  }, [definitions, placed])
  const move = useCallback((x, y, z) => setDraft(current => current && transform(point(round(current.position.x + x), round(current.position.y + y), round(current.position.z + z)), current.rotation)), [])
  const rotate = useCallback(direction => setDraft(current => current && transform(current.position, point(current.rotation.x, round(current.rotation.y + direction * TURN), current.rotation.z))), [])
  const cycleWall = useCallback(() => setDraft(current => {
    if (!current) return current
    const { minX, maxX, minZ, maxZ } = PLACEMENT_BOUNDS.floor
    const walls = [
      [point(0, current.position.y, maxZ), point(0, Math.PI, 0)],
      [point(maxX, current.position.y, 0), point(0, -Math.PI / 2, 0)],
      [point(0, current.position.y, minZ), point(0, 0, 0)],
      [point(minX, current.position.y, 0), point(0, Math.PI / 2, 0)],
    ]
    const index = Math.abs(current.position.z - maxZ) < .08 ? 1 : Math.abs(current.position.x - maxX) < .08 ? 2 : Math.abs(current.position.z - minZ) < .08 ? 3 : 0
    return transform(walls[index][0], walls[index][1])
  }), [])

  useEffect(() => {
    if (!draft) return undefined
    const key = event => {
      if (event.code === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); setDraft(null); setSelectedId(null); return }
      const actions = { ArrowLeft: () => move(-STEP, 0, 0), KeyA: () => move(-STEP, 0, 0), ArrowRight: () => move(STEP, 0, 0), KeyD: () => move(STEP, 0, 0), ArrowUp: () => definition?.placement_kind === 'wall' ? move(0, STEP, 0) : move(0, 0, -STEP), KeyW: () => definition?.placement_kind === 'wall' ? move(0, STEP, 0) : move(0, 0, -STEP), ArrowDown: () => definition?.placement_kind === 'wall' ? move(0, -STEP, 0) : move(0, 0, STEP), KeyS: () => definition?.placement_kind === 'wall' ? move(0, -STEP, 0) : move(0, 0, STEP), KeyQ: () => rotate(-1), KeyE: () => rotate(1) }
      if (actions[event.code]) { event.preventDefault(); actions[event.code]() }
    }
    window.addEventListener('keydown', key, true)
    return () => window.removeEventListener('keydown', key, true)
  }, [definition, draft, move, rotate])

  const finish = () => { setSelectedId(null); setDraft(null); onPreview?.(null) }
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ['tcg-room-bootstrap'] }), qc.invalidateQueries({ queryKey: ['tcg-room-furniture'] })])
  const handleError = error => { if (error.response?.status === 409) { finish(); refresh(); toast.error('The room changed elsewhere. Latest layout loaded; choose the item again.') } else toast.error(error.response?.data?.detail || 'Could not update the room') }
  const commit = useMutation({
    mutationFn: () => existing ? tcgRoomApi.moveFurniture(selectedId, { expected_revision: room.revision, transform: draft, snap_anchor: definition.placement_kind }) : tcgRoomApi.placeFurniture(selectedId, { expected_revision: room.revision, transform: draft, snap_anchor: definition.placement_kind }),
    onSuccess: () => { finish(); refresh(); toast.success(existing ? 'Furniture moved' : 'Furniture placed') }, onError: handleError,
  })
  const storeItem = useMutation({ mutationFn: id => tcgRoomApi.returnFurniture(id, room.revision), onSuccess: () => { finish(); refresh(); toast.success('Returned to Furniture Inventory') }, onError: handleError })
  const history = useMutation({ mutationFn: kind => kind === 'undo' ? tcgRoomApi.undoLayout(room.revision) : tcgRoomApi.redoLayout(room.revision), onSuccess: () => { finish(); refresh(); toast.success('Layout updated') }, onError: handleError })

  return <div className="placement-mode">
    <header><div><span>PLACEMENT MODE</span><strong>Make the room yours</strong><small>Choose an owned item, position it, then confirm. Items are never resized.</small></div><button disabled={history.isPending} onClick={() => history.mutate('undo')}><Undo2 size={18} /> Undo</button><button disabled={history.isPending} onClick={() => history.mutate('redo')}><Redo2 size={18} /> Redo</button></header>
    <div className="placement-mode__body">
      <aside><h3><PackageOpen size={20} /> Furniture Inventory</h3><p>{instances.filter(item => item.status !== 'placed').length} items ready to place</p><div>{instances.map(instance => {
        const itemDefinition = definitions.get(instance.definition_id)
        return <button key={instance.id} className={`${instance.id === selectedId ? 'selected' : ''} ${instance.status === 'placed' ? 'placed' : ''}`} onClick={() => select(instance)}><span>{itemDefinition?.name || `Room item ${instance.id}`}</span><small>{instance.variant_key} · #{instance.id}</small><b>{instance.status === 'placed' ? 'Placed' : 'In inventory'}</b></button>
      })}</div></aside>
      <section>{draft ? <>
        <div className={`placement-mode__status ${invalid ? 'invalid' : 'valid'}`}><strong>{definition?.name}</strong><span>{invalid || 'Valid position — ready to place'}</span></div>
        <div className="placement-mode__pad">
          {definition?.placement_kind === 'wall' ? <><button onClick={() => move(0, STEP, 0)}><ArrowUp /> Up</button><div><button onClick={() => move(-STEP, 0, 0)}><ArrowLeft /> Left</button><button onClick={() => move(STEP, 0, 0)}>Right <ArrowRight /></button></div><button onClick={() => move(0, -STEP, 0)}><ArrowDown /> Down</button><button onClick={cycleWall}>Move to next wall</button></> : <><button onClick={() => move(0, 0, -STEP)}><ArrowUp /> Forward</button><div><button onClick={() => move(-STEP, 0, 0)}><ArrowLeft /> Left</button><button onClick={() => move(STEP, 0, 0)}>Right <ArrowRight /></button></div><button onClick={() => move(0, 0, STEP)}><ArrowDown /> Back</button></>}
        </div>
        <div className="placement-mode__rotate"><button onClick={() => rotate(-1)}><RotateCcw /> Rotate left 15°</button><button onClick={() => rotate(1)}><RotateCw /> Rotate right 15°</button></div>
        <p className="placement-mode__hint">Keyboard: WASD or arrows to move · Q/E to rotate · Escape to cancel</p>
        <footer>{existing && <button className="danger" disabled={storeItem.isPending} onClick={() => storeItem.mutate(selectedId)}>Return to inventory</button>}<button onClick={finish}><X /> Cancel</button><button className="primary" disabled={Boolean(invalid) || commit.isPending} onClick={() => commit.mutate()}><Check /> {commit.isPending ? 'Saving...' : 'Confirm placement'}</button></footer>
      </> : <div className="placement-mode__welcome"><PackageOpen size={42} /><h2>Choose furniture from your inventory</h2><p>Each copy is separate, so you can own and place as many cabinets, shelves, and posters as you want.</p></div>}</section>
    </div>
  </div>
}

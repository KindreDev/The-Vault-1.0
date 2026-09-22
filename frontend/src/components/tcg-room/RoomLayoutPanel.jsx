import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Redo2, Undo2, X } from 'lucide-react'
import { tcgRoomApi } from '../../lib/api'
import { AUTHORED_SURFACES, FLOOR_Y, ROOM_SIZE, SHELF_SUPPORT_SLOTS, SURFACE_ASSETS, SURFACE_HOST_ASSETS, WALL_BASE_ORIGIN_ASSETS, furnitureDisplayName, furniturePreviewAssetId, furniturePreviewMirrorX } from './roomLayout'

const point = (x = 0, y = 0, z = 0) => ({ x, y, z })
const transform = (position = point(), rotation = point()) => ({ position, rotation })
const transformWithContent = (current, position, rotation) => {
  const next = transform(position, rotation)
  if (current?.content && typeof current.content === 'object') next.content = current.content
  return next
}
const round = value => Math.round(value * 1000) / 1000

function furniturePreviewUrl(assetId) {
  return `/tcg-room/shop/${encodeURIComponent(furniturePreviewAssetId(assetId) || '')}.png`
}

function FurnitureThumbnail({ assetId }) {
  const canvasRef = useRef(null)
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !assetId || assetId === 'poster_frame') return undefined
    const image = new Image()
    image.decoding = 'async'
    image.onload = () => {
      const width = canvas.width
      const height = canvas.height
      const context = canvas.getContext('2d', { willReadFrequently: true })
      if (!context) return
      context.clearRect(0, 0, width, height)
      const scale = Math.min(width / image.naturalWidth, height / image.naturalHeight)
      const drawWidth = image.naturalWidth * scale
      const drawHeight = image.naturalHeight * scale
      if (furniturePreviewMirrorX(assetId)) {
        context.save()
        context.translate(width, 0)
        context.scale(-1, 1)
      }
      context.drawImage(image, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight)
      if (furniturePreviewMirrorX(assetId)) context.restore()
      const pixels = context.getImageData(0, 0, width, height)
      const { data } = pixels
      const sample = index => [data[index], data[index + 1], data[index + 2]]
      const corners = [sample(0), sample((width - 1) * 4), sample((height - 1) * width * 4), sample(((height * width) - 1) * 4)]
      const background = corners.reduce((total, color) => total.map((value, index) => value + color[index]), [0, 0, 0]).map(value => value / corners.length)
      const visited = new Uint8Array(width * height)
      const queue = []
      const push = (x, y) => {
        if (x < 0 || y < 0 || x >= width || y >= height) return
        const index = y * width + x
        if (visited[index]) return
        visited[index] = 1
        queue.push(index)
      }
      for (let x = 0; x < width; x++) { push(x, 0); push(x, height - 1) }
      for (let y = 1; y < height - 1; y++) { push(0, y); push(width - 1, y) }
      while (queue.length) {
        const index = queue.shift()
        const pixel = index * 4
        const distance = Math.hypot(data[pixel] - background[0], data[pixel + 1] - background[1], data[pixel + 2] - background[2])
        if (distance > 34 || data[pixel + 3] === 0) continue
        data[pixel + 3] = 0
        const x = index % width
        const y = Math.floor(index / width)
        push(x - 1, y); push(x + 1, y); push(x, y - 1); push(x, y + 1)
      }
      context.putImageData(pixels, 0, 0)
    }
    image.src = furniturePreviewUrl(assetId)
    return () => { image.onload = null }
  }, [assetId])
  if (assetId === 'poster_frame') return <span className="placement-mode__poster-thumb" aria-hidden="true"><i /></span>
  return <canvas ref={canvasRef} width="82" height="82" aria-hidden="true" />
}

function defaultTransform(definition) {
  return definition?.placement_kind === 'wall'
    ? transform(point(0, 1.5, 0), point(0, 0, 0))
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

function wallBox(definition, value) {
  const footprint = definition?.footprint || { width: .5, depth: .5 }
  const yaw = value.rotation?.y || 0
  const normalX = Math.sin(yaw)
  const normalZ = Math.cos(yaw)
  const axis = Math.abs(normalX) >= Math.abs(normalZ) ? 'x' : 'z'
  const coordinate = axis === 'x' ? value.position.x : value.position.z
  const tangent = axis === 'x' ? value.position.z : value.position.x
  const tangentSize = axis === 'x'
    ? Math.abs(Math.sin(yaw)) * (footprint.width || .5) + Math.abs(Math.cos(yaw)) * (footprint.depth || .5)
    : Math.abs(Math.cos(yaw)) * (footprint.width || .5) + Math.abs(Math.sin(yaw)) * (footprint.depth || .5)
  const height = Math.max(.05, definition?.footprint?.height || .5)
  const baseOrigin = WALL_BASE_ORIGIN_ASSETS.has(definition?.asset_id)
  return {
    axis,
    coordinate,
    normalSign: axis === 'x' ? (normalX >= 0 ? 1 : -1) : (normalZ >= 0 ? 1 : -1),
    tangentMin: tangent - tangentSize / 2,
    tangentMax: tangent + tangentSize / 2,
    verticalMin: baseOrigin ? value.position.y : value.position.y - height / 2,
    verticalMax: baseOrigin ? value.position.y + height : value.position.y + height / 2,
  }
}

const wallOverlaps = (a, b) => a.axis === b.axis && a.normalSign === b.normalSign && Math.abs(a.coordinate - b.coordinate) <= .16 && a.tangentMin < b.tangentMax && a.tangentMax > b.tangentMin && a.verticalMin < b.verticalMax && a.verticalMax > b.verticalMin

function surfaceHosts(placed, definitions, instances) {
  const hosts = AUTHORED_SURFACES.map(host => ({ ...host }))
  for (const row of placed) {
    const instance = instances.find(item => item.id === row.instance_id)
    const other = definitions.get(instance?.definition_id)
    if (!other || !SURFACE_HOST_ASSETS.has(other.asset_id)) continue
    const slots = other.footprint?.support_slots || SHELF_SUPPORT_SLOTS[other.asset_id] || []
    for (const slot of slots) {
      const slotBox = placementBox({ footprint: { width: slot.width, depth: slot.depth } }, row.transform)
      hosts.push({ minX: slotBox.minX, maxX: slotBox.maxX, minZ: slotBox.minZ, maxZ: slotBox.maxZ, top: (row.transform?.position?.y || 0) + slot.y })
    }
  }
  return hosts
}

const isShelf = definition => Boolean(definition && SURFACE_HOST_ASSETS.has(definition.asset_id))

function validate(definition, value, placed, definitions, instances, selectedId) {
  const { position } = value
  if (definition?.placement_kind === 'wall') {
    if (position.y < .12 || position.y > 2.75) return 'Keep it on the wall'
    const box = wallBox(definition, value)
    if (box.verticalMin < 0 || box.verticalMax > ROOM_SIZE.height) return 'Keep the whole item within the wall height'
    for (const row of placed) {
      if (row.instance_id === selectedId) continue
      const instance = instances.find(item => item.id === row.instance_id)
      const other = definitions.get(instance?.definition_id)
      if (isShelf(definition) && isShelf(other) && overlaps(box, placementBox(other, row.transform))) return 'This overlaps another shelf'
      if (other?.placement_kind === 'wall' && wallOverlaps(box, wallBox(other, row.transform))) return 'This overlaps another wall item'
    }
    return null
  }
  const box = placementBox(definition, value)
  if (SURFACE_ASSETS.has(definition?.asset_id)) {
    const host = surfaceHosts(placed, definitions, instances).find(item => (
      Math.abs(position.y - item.top) <= .10 &&
      box.minX >= item.minX && box.maxX <= item.maxX &&
      box.minZ >= item.minZ && box.maxZ <= item.maxZ
    ))
    if (!host) return 'Place this on a table, desk, stand, or counter — not the floor'
    return null
  }
  for (const row of placed) {
    if (row.instance_id === selectedId) continue
    const instance = instances.find(item => item.id === row.instance_id)
    const other = definitions.get(instance?.definition_id)
    if (isShelf(other) && overlaps(box, placementBox(other, row.transform))) return 'This overlaps another shelf'
    if (other?.placement_kind === 'floor' && !SURFACE_ASSETS.has(other.asset_id) && overlaps(box, placementBox(other, row.transform))) return 'This overlaps another placed item'
  }
  return null
}

export default function RoomLayoutPanel({ bootstrap, onPreview, initialInstanceId = null, worldSample = null, onConfirmReady, onLockReady, onDeselectReady, onActionsReady, onExit }) {
  const qc = useQueryClient()
  const room = bootstrap?.room || { revision: 0, placements: [] }
  const definitions = useMemo(() => new Map((bootstrap?.catalog || []).filter(item => item.asset_id && ['floor', 'wall'].includes(item.placement_kind)).map(item => [item.id, item])), [bootstrap])
  const instances = useMemo(() => (bootstrap?.owned_instances || []).filter(item => definitions.has(item.definition_id)), [bootstrap, definitions])
  const [selectedId, setSelectedId] = useState(null)
  const [draft, setDraft] = useState(null)
  const [pinned, setPinned] = useState(false)
  const [locked, setLocked] = useState(false)
  const lastInitialId = useRef(null)
  const commitRef = useRef(null)
  const selected = instances.find(item => item.id === selectedId)
  const definition = definitions.get(selected?.definition_id)
  const placed = room.placements || []
  const existing = placed.find(item => item.instance_id === selectedId)
  const invalid = draft ? validate(definition, draft, placed, definitions, instances, selectedId) : null

  useEffect(() => { onPreview?.(draft && definition ? { instanceId: selectedId, assetId: definition.asset_id, transform: draft, valid: !invalid, reason: invalid, definition, pinned, locked } : null) }, [definition, draft, invalid, locked, onPreview, pinned, selectedId])
  useEffect(() => () => onPreview?.(null), [onPreview])

  const select = useCallback(instance => {
    const saved = placed.find(item => item.instance_id === instance.id)?.transform
    setSelectedId(instance.id)
    setPinned(Boolean(saved))
    setLocked(false)
    setDraft(saved || defaultTransform(definitions.get(instance.definition_id)))
  }, [definitions, placed])
  useEffect(() => {
    if (!worldSample || !selectedId || !definition || locked) return
    if (worldSample.kind === 'rotate') {
      setDraft(current => current && transformWithContent(current, current.position, point(0, round(worldSample.yaw), 0)))
      return
    }
    const y = definition.placement_kind === 'wall' || SURFACE_ASSETS.has(definition.asset_id) ? worldSample.y : FLOOR_Y
    setDraft(current => transformWithContent(current, point(round(worldSample.x), round(y), round(worldSample.z)), point(0, round(worldSample.yaw || 0), 0)))
    setPinned(false)
  }, [definition, locked, selectedId, worldSample])
  useEffect(() => {
    if (initialInstanceId == null || lastInitialId.current === initialInstanceId) return
    if (selectedId) return
    lastInitialId.current = initialInstanceId
    const instance = instances.find(item => item.id === initialInstanceId)
    if (instance) select(instance)
  }, [initialInstanceId, instances, select, selectedId])
  const finish = () => { setSelectedId(null); setDraft(null); setPinned(false); setLocked(false); onPreview?.(null) }
  useEffect(() => {
    onDeselectReady?.(finish)
    return () => onDeselectReady?.(() => {})
  }, [onDeselectReady, selectedId, draft, locked, pinned])
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ['tcg-room-bootstrap'] }), qc.invalidateQueries({ queryKey: ['tcg-room-furniture'] })])
  const handleError = error => { if (error.response?.status === 409) { finish(); refresh(); toast.error('The room changed elsewhere. Latest layout loaded; choose the item again.') } else toast.error(error.response?.data?.detail || 'Could not update the room') }
  const commit = useMutation({
    mutationFn: () => existing ? tcgRoomApi.moveFurniture(selectedId, { expected_revision: room.revision, transform: draft, snap_anchor: definition.placement_kind }) : tcgRoomApi.placeFurniture(selectedId, { expected_revision: room.revision, transform: draft, snap_anchor: definition.placement_kind }),
    onSuccess: () => { finish(); refresh(); toast.success(existing ? 'Furniture moved' : 'Furniture placed') }, onError: handleError,
  })
  commitRef.current = { commit, invalid, draft, locked }
  useEffect(() => {
    onConfirmReady?.(() => {
      const current = commitRef.current
      if (!current?.draft || current.invalid || !current.locked) return
      current.commit.mutate()
    })
  }, [onConfirmReady])
  const storeItem = useMutation({ mutationFn: id => tcgRoomApi.returnFurniture(id, room.revision), onSuccess: () => { finish(); refresh(); toast.success('Returned to Furniture Inventory') }, onError: handleError })
  const history = useMutation({ mutationFn: kind => kind === 'undo' ? tcgRoomApi.undoLayout(room.revision) : tcgRoomApi.redoLayout(room.revision), onSuccess: () => { finish(); refresh(); toast.success('Layout updated') }, onError: handleError })
  useEffect(() => {
    const lock = () => {
      const current = commitRef.current
      if (!current?.draft || current.invalid || current.locked) return
      setLocked(true)
    }
    const place = () => {
      const current = commitRef.current
      if (!current?.draft || current.invalid || !current.locked || current.commit.isPending) return
      current.commit.mutate()
    }
    const returnToInventory = () => {
      if (existing && selectedId != null) storeItem.mutate(selectedId)
      else finish()
    }
    const rotate = () => setDraft(current => current && transformWithContent(current, current.position, point(0, round((current.rotation?.y || 0) + .12), 0)))
    onLockReady?.(lock)
    onActionsReady?.({ place, returnToInventory, rotate, deselect: finish })
    return () => { onLockReady?.(null); onActionsReady?.(null) }
  }, [existing, finish, onActionsReady, onLockReady, selectedId, storeItem])

  return <div className="placement-mode placement-mode--live">
    <div className="placement-mode__rail">
      <div className="placement-mode__strip" onWheel={event => {
        if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return
        if (event.currentTarget.scrollWidth <= event.currentTarget.clientWidth) return
        event.preventDefault()
        event.stopPropagation()
        event.currentTarget.scrollLeft += event.deltaY
      }}>{instances.map(instance => {
      const itemDefinition = definitions.get(instance.definition_id)
      return <button key={instance.id} disabled={locked && instance.id !== selectedId} className={`${instance.id === selectedId ? 'selected' : ''} ${instance.status === 'placed' ? 'placed' : ''}`} onClick={() => select(instance)}>
        <span className="placement-mode__thumb"><FurnitureThumbnail assetId={itemDefinition?.asset_id} /></span>
        <span className="placement-mode__item-copy">
          <strong>{furnitureDisplayName(itemDefinition?.name || `Room item ${instance.id}`, itemDefinition?.asset_id, instance.variant_key)}</strong>
          <b>{instance.status === 'placed' ? 'Placed' : 'Ready'}</b>
        </span>
      </button>
      })}</div>
      <div className="placement-mode__rail-actions">
        <button type="button" disabled={history.isPending} onClick={() => history.mutate('undo')} title="Undo"><Undo2 size={18} /><span>Undo</span></button>
        <button type="button" disabled={history.isPending} onClick={() => history.mutate('redo')} title="Redo"><Redo2 size={18} /><span>Redo</span></button>
        <button type="button" onClick={onExit} title="Done"><X size={18} /><span>Done</span></button>
      </div>
    </div>
    <span className="placement-mode__context-hint">{locked ? 'Locked · Use Place to commit or Return to cancel' : 'Click the scene to lock the item · Right click deselects · Hold right mouse to look'}</span>
  </div>
}

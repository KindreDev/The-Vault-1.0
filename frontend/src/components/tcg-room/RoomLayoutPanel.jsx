import { LocalizedText, useT } from '../../i18n'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Grid3x3, Redo2, Undo2, X } from 'lucide-react'
import { tcgRoomApi } from '../../lib/api'
import { FLOOR_Y, SURFACE_ASSETS, furnitureDisplayName, furniturePreviewAssetId, furniturePreviewMirrorX } from './roomLayout'
import { stepRotation, validatePlacement } from './roomPlacementRules'

const point = (x = 0, y = 0, z = 0) => ({ x, y, z })
const transform = (position = point(), rotation = point()) => ({ position, rotation })
const transformWithContent = (current, position, rotation) => {
  const next = transform(position, rotation)
  if (current?.content && typeof current.content === 'object') next.content = current.content
  return next
}
const round = value => Math.round(value * 1000) / 1000
const readGridSnap = () => { try { return localStorage.getItem('vault.tcg-room.grid-snap') !== '0' } catch { return true } }

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
  return <canvas ref={canvasRef} width="112" height="112" aria-hidden="true" />
}

function defaultTransform(definition) {
  return definition?.placement_kind === 'wall'
    ? transform(point(0, 1.5, 0), point(0, 0, 0))
    : transform(point(0, FLOOR_Y, 0), point())
}

export default function RoomLayoutPanel({ bootstrap, onPreview, placementRequest = null, worldSample = null, onLockReady, onDeselectReady, onExit }) {
  const t = useT()
  const qc = useQueryClient()
  const room = bootstrap?.room || { revision: 0, placements: [] }
  const definitions = useMemo(() => new Map((bootstrap?.catalog || []).filter(item => item.asset_id && ['floor', 'wall'].includes(item.placement_kind)).map(item => [item.id, item])), [bootstrap])
  const instances = useMemo(() => (bootstrap?.owned_instances || []).filter(item => definitions.has(item.definition_id)), [bootstrap, definitions])
  const [selectedId, setSelectedId] = useState(null)
  const [draft, setDraft] = useState(null)
  const [pinned, setPinned] = useState(false)
  const [locked, setLocked] = useState(false)
  const [gridSnap, setGridSnap] = useState(readGridSnap)
  const lastInitialId = useRef(null)
  const commitRef = useRef(null)
  const selected = instances.find(item => item.id === selectedId)
  const definition = definitions.get(selected?.definition_id)
  const placed = room.placements || []
  const existing = placed.find(item => item.instance_id === selectedId)
  const invalid = draft ? validatePlacement(definition, draft, placed, definitions, instances, selectedId) : null

  useEffect(() => { onPreview?.(draft && definition ? { instanceId: selectedId, assetId: definition.asset_id, transform: draft, valid: !invalid, reason: invalid, definition, pinned, locked, gridSnap } : null) }, [definition, draft, gridSnap, invalid, locked, onPreview, pinned, selectedId])
  useEffect(() => { try { localStorage.setItem('vault.tcg-room.grid-snap', gridSnap ? '1' : '0') } catch { /* Storage can be unavailable. */ } }, [gridSnap])
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
    if (placementRequest == null || lastInitialId.current === placementRequest.nonce) return
    if (selectedId) return
    lastInitialId.current = placementRequest.nonce
    const instance = instances.find(item => item.id === placementRequest.id)
    if (instance) select(instance)
  }, [placementRequest, instances, select, selectedId])
  const finish = useCallback(() => { setSelectedId(null); setDraft(null); setPinned(false); setLocked(false); onPreview?.(null) }, [onPreview])
  useEffect(() => {
    onDeselectReady?.(finish)
    return () => onDeselectReady?.(() => {})
  }, [finish, onDeselectReady])
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ['tcg-room-bootstrap'] }), qc.invalidateQueries({ queryKey: ['tcg-room-furniture'] })])
  const handleError = error => {
    setLocked(false)
    if (error.response?.status === 409) { finish(); refresh(); toast.error(t("The room changed elsewhere. Latest layout loaded; choose the item again.")) } else toast.error(error.response?.data?.detail || t("Could not update the room"))
  }
  const commit = useMutation({
    mutationFn: () => existing ? tcgRoomApi.moveFurniture(selectedId, { expected_revision: room.revision, transform: draft, snap_anchor: definition.placement_kind }) : tcgRoomApi.placeFurniture(selectedId, { expected_revision: room.revision, transform: draft, snap_anchor: definition.placement_kind }),
    onSuccess: () => { finish(); refresh(); toast.success(existing ? t("Furniture moved") : t("Furniture placed")) }, onError: handleError,
  })
  const storeItem = useMutation({ mutationFn: id => tcgRoomApi.returnFurniture(id, room.revision), onSuccess: () => { finish(); refresh(); toast.success(t("Returned to Furniture Inventory")) }, onError: handleError })
  const history = useMutation({ mutationFn: kind => kind === 'undo' ? tcgRoomApi.undoLayout(room.revision) : tcgRoomApi.redoLayout(room.revision), onSuccess: () => { finish(); refresh(); toast.success(t("Layout updated")) }, onError: handleError })
  commitRef.current = { commit, storeItem, invalid, draft, locked, existing, selectedId }
  useEffect(() => {
    // One click places the item, like build mode in The Sims.  The item is
    // frozen while the save is in flight and released again if it fails.
    const place = () => {
      const current = commitRef.current
      if (!current?.draft || current.invalid || current.locked || current.commit.isPending) return
      setLocked(true)
      current.commit.mutate()
    }
    onLockReady?.(place)
    return () => onLockReady?.(null)
  }, [onLockReady])
  useEffect(() => {
    const keys = event => {
      if (event.target?.closest?.('input, textarea, [contenteditable="true"]')) return
      if (event.code === 'KeyG') { event.preventDefault(); setGridSnap(value => !value); return }
      if (!commitRef.current?.selectedId) return
      if (event.code === 'Delete' || event.code === 'Backspace') {
        event.preventDefault()
        if (commitRef.current.existing) commitRef.current.storeItem.mutate(commitRef.current.selectedId)
        else finish()
      }
    }
    window.addEventListener('keydown', keys)
    return () => window.removeEventListener('keydown', keys)
  }, [finish])

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
        <button type="button" className={gridSnap ? 'is-active' : ''} aria-pressed={gridSnap} onClick={() => setGridSnap(value => !value)} title={t("Snap to grid (G)")}><Grid3x3 size={18} /><span><LocalizedText text={"Grid"} /></span></button>
        <button type="button" disabled={history.isPending} onClick={() => history.mutate('undo')} title={t("Undo")}><Undo2 size={18} /><span><LocalizedText text={"Undo"} /></span></button>
        <button type="button" disabled={history.isPending} onClick={() => history.mutate('redo')} title={t("Redo")}><Redo2 size={18} /><span><LocalizedText text={"Redo"} /></span></button>
        <button type="button" onClick={onExit} title={t("Done")}><X size={18} /><span><LocalizedText text={"Done"} /></span></button>
      </div>
    </div>
    <span className="placement-mode__context-hint">{locked
      ? t("Saving placement…")
      : selectedId
        ? (invalid ? `${t(invalid)} · ` : '') + t("Click to place · Q / E rotate 45° (Alt for 15°) · Alt free move · G grid · Del return to inventory · Esc or right-click cancel")
        : t("Pick an item below, or click furniture in the room to move it · Hold right mouse button to look around")}</span>
  </div>
}

import { Component, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, Box, CircleHelp, DoorOpen, Home, PackageOpen, Settings2, X } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { cardsApi, tcgRoomApi, tcgV2Api } from '../../lib/api'
import RoomScene from './RoomScene'
import RoomDeviceSurface from './RoomDeviceSurface'
import RoomParcelPanel from './RoomParcelPanel'
import RoomCopyManager from './RoomCopyManager'
import RoomDisplayManager from './RoomDisplayManager'
import RoomLayoutPanel from './RoomLayoutPanel'
import RoomInventory from './RoomInventory'
import TraderVN from './TraderVN'
import TCGV2CardFace from '../tcg-v2/TCGV2CardFace'
import './tcg-room.css'

class RoomCanvasBoundary extends Component {
  state = { error: null }
  static getDerivedStateFromError(error) { return { error } }
  render() {
    if (this.state.error) return <div className="tcg-room__fatal"><strong>The room renderer stopped</strong><p>{this.state.error.message}</p><button onClick={() => window.location.reload()}>Reload room</button></div>
    return this.props.children
  }
}

const DEV_FOCUS = Object.freeze({
  computer: { interactive: 'computer', position: [-4.45, 1.25, -3.58], copy: ['Use computer', 'Browse the real TCG collection and order packs online'] },
  binder: { interactive: 'binder', position: [3.02, .93, -.8], copy: ['Open binder', 'Manage the same binder used by the 2D collection'] },
  parcel: { interactive: 'parcel', position: [3.02, .93, -.8], copy: ['Open booster packs', 'Unseal the delivered booster packs before revealing them'] },
  door: { interactive: 'door', position: [3.06, 1.1, 4.89], copy: ['Visit trader', "Step outside to meet this week's visitor"] },
})

function isTextEntryTarget(target) {
  const element = typeof Element !== 'undefined' && target instanceof Element ? target : null
  return Boolean(element && (['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName) || element.isContentEditable || element.closest('[contenteditable="true"]')))
}

function PerformanceOverlay({ metrics, quality, visibleCards, loadedAssets }) {
  if (!import.meta.env.DEV) return null
  const fps = metrics.frameMs > 0 ? 1000 / metrics.frameMs : 0
  return <aside className="tcg-room__perf" aria-label="Collection Room renderer performance">
    <strong>ROOM PERF <kbd>F3</kbd></strong>
    <span>{metrics.frameMs ? `${metrics.frameMs.toFixed(1)} ms` : '—'} · {fps ? `${fps.toFixed(0)} FPS` : '—'}</span>
    <span>{metrics.calls.toLocaleString()} draw calls · {metrics.triangles.toLocaleString()} triangles</span>
    <span>{metrics.textures.toLocaleString()} textures · {metrics.geometries.toLocaleString()} geometries</span>
    <span>{quality.toUpperCase()} · {visibleCards.toLocaleString()} cards · {loadedAssets.toLocaleString()} assets</span>
  </aside>
}

function developmentPreview() {
  if (!import.meta.env.DEV) return { focus: null, parcel: null, traderProof: null }
  const params = new URLSearchParams(window.location.search)
  const focus = DEV_FOCUS[params.get('roomFocus')] || null
  const parcelStatus = params.get('roomParcel')
  const parcel = parcelStatus && ['ready', 'collected', 'placed'].includes(parcelStatus) ? {
    id: 'preview', status: parcelStatus, total_price: 1200,
    ready_at: new Date().toISOString(), placement: { snap_anchor: 'sorting_mat' },
    contents: [{ product_id: 1, quantity: 1, product: { name: 'Permanent Vault Booster' } }],
  } : null
  return { focus, parcel, traderProof: params.get('roomTraderProof') }
}

export default function TCGRoomRuntime({ version }) {
  const navigate = useNavigate()
  const preview = useMemo(developmentPreview, [])
  // The room is immediately walkable when it mounts. Menus and interactions
  // still pause it explicitly; entering/exiting inventory is not required to
  // wake the controller anymore.
  const [paused, setPaused] = useState(false)
  const [nearby, setNearby] = useState(null)
  const [focused, setFocused] = useState(preview.focus)
  const [arranging, setArranging] = useState(false)
  const [inventoryOpen, setInventoryOpen] = useState(false)
  const [inventoryTab, setInventoryTab] = useState('cards')
  const [helpOpen, setHelpOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [placementInstanceId, setPlacementInstanceId] = useState(null)
  const [placementPreview, setPlacementPreview] = useState(null)
  const [worldSample, setWorldSample] = useState(null)
  const confirmPlacement = useRef(() => {})
  const lockPlacement = useRef(() => {})
  const deselectPlacement = useRef(() => {})
  const returnPlacement = useRef(() => {})
  const rotatePlacement = useRef(() => {})
  const [doorTransition, setDoorTransition] = useState(false)
  const [traderOpen, setTraderOpen] = useState(false)
  const [quality, setQuality] = useState(() => localStorage.getItem('vault.tcg-room.quality') || 'medium')
  const [confirmExit, setConfirmExit] = useState(false)
  const [metrics, setMetrics] = useState({ frameMs: 0, calls: 0, triangles: 0, textures: 0, geometries: 0 })
  const [loadedAssets, setLoadedAssets] = useState(0)
  const [sceneReady, setSceneReady] = useState(false)
  const [visibleCardCount, setVisibleCardCount] = useState(0)
  const [perfOpen, setPerfOpen] = useState(false)
  const [inspectTilt, setInspectTilt] = useState({ x: 0, y: 0 })
  const readySeen = useRef(null)
  const { data, isError, error, refetch } = useQuery({ queryKey: ['tcg-room-bootstrap'], queryFn: () => tcgRoomApi.bootstrap().then(r => r.data), refetchInterval: 3000 })
  const { data: furniture } = useQuery({ queryKey: ['tcg-room-furniture'], queryFn: () => tcgRoomApi.furniture().then(r => r.data), refetchInterval: 3000 })
  const { data: inventorySummary } = useQuery({ queryKey: ['tcg-room-inventory'], queryFn: () => tcgRoomApi.inventory().then(r => r.data), refetchInterval: 8000 })
  const { data: ownedCatalog } = useQuery({ queryKey: ['tcg-v2-catalog', 'room-count'], queryFn: () => tcgV2Api.catalog({ ownership: 'owned', limit: 1 }).then(r => r.data), staleTime: 15_000 })
  const roomData = useMemo(() => furniture ? { ...data, ...furniture, room: data?.room, assignments: data?.assignments } : data, [data, furniture])
  const { data: carriedCopies = [] } = useQuery({ queryKey: ['tcg-room-copies', 'carried'], queryFn: () => tcgRoomApi.copies({ location_kind: 'carried' }).then(r => r.data), refetchInterval: 3000 })
  const { data: visibleCards = { items: [], counts: {} } } = useQuery({ queryKey: ['tcg-room-visible-cards'], queryFn: () => tcgRoomApi.visibleCards().then(r => r.data), refetchInterval: 3000 })
  const proofParams = import.meta.env.DEV ? new URLSearchParams(window.location.search) : null
  const fixtureCardId = Number(proofParams?.get('roomCardFixture') || 0)
  const fixtureInstanceId = Number(proofParams?.get('roomCardFixtureInstance') || 0)
  const proofCardId = Number(proofParams?.get('roomCardProof') || fixtureCardId || 0)
  const { data: fixtureCard = null } = useQuery({
    queryKey: ['tcg-room-dev-card-fixture', fixtureCardId],
    queryFn: () => cardsApi.get(fixtureCardId).then(r => r.data),
    enabled: import.meta.env.DEV && fixtureCardId > 0,
    staleTime: Infinity,
  })
  const fixtureItem = useMemo(() => fixtureCard ? {
    copy: { id: `dev-fixture-${fixtureCard.id}`, location_kind: 'display_stand', location_ref: fixtureInstanceId ? String(fixtureInstanceId) : undefined },
    display_instance_id: fixtureInstanceId || undefined,
    slot_key: 'primary',
    surface: 'display', material_ready: true, card: fixtureCard,
    preview: { card_id: fixtureCard.id, rarity: fixtureCard.rarity_class, card_type: fixtureCard.card_type, title: fixtureCard.display_name },
    dev_fixture: true,
  } : null, [fixtureCard, fixtureInstanceId])
  const sceneVisibleCards = fixtureItem ? { items: [fixtureItem], counts: { rendered: 1, preparing: 0 } } : visibleCards
  const proofCard = proofCardId ? sceneVisibleCards.items.find(item => Number(item.preview?.card_id) === proofCardId) : null

  useEffect(() => { localStorage.setItem('vault.tcg-room.quality', quality) }, [quality])
  useEffect(() => {
    if (loadedAssets > 0 && data) {
      setSceneReady(true)
      if (!preview.focus && !preview.traderProof) setPaused(false)
    }
  }, [data, loadedAssets])
  useEffect(() => {
    const keyboard = event => {
      if (isTextEntryTarget(event.target)) return
      if (import.meta.env.DEV && event.code === 'F3') {
        event.preventDefault()
        setPerfOpen(value => !value)
        return
      }
      if (event.code === 'KeyI') {
        event.preventDefault()
        if (inventoryOpen) { setInventoryOpen(false); setPaused(false); return }
        if (confirmExit || traderOpen) return
        document.exitPointerLock?.()
        setFocused(null); setArranging(false); setPlacementInstanceId(null); setPaused(true); setInventoryTab('cards'); setInventoryOpen(true)
        return
      }
      if (event.code === 'Tab') {
        event.preventDefault()
        if (confirmExit || traderOpen || inventoryOpen) return
        if (arranging) { setArranging(false); setPlacementInstanceId(null); setPlacementPreview(null); setPaused(false); return }
        document.exitPointerLock?.()
        setFocused(null); setPlacementInstanceId(null); setPlacementPreview(null); setWorldSample(null); setPaused(false); setArranging(true)
        return
      }
      if (event.code !== 'Escape') return
      if (helpOpen) { setHelpOpen(false); return }
      if (settingsOpen) { setSettingsOpen(false); return }
      if (inventoryOpen) { setInventoryOpen(false); setPaused(false); return }
      if (confirmExit) { setConfirmExit(false); return }
      if (traderOpen) { setTraderOpen(false); setDoorTransition(false); setFocused(null); setPaused(true); return }
      if (focused || arranging) { setFocused(null); setArranging(false); setPaused(false); return }
      if (!paused) { document.exitPointerLock?.(); setPaused(true) }
    }
    window.addEventListener('keydown', keyboard)
    return () => window.removeEventListener('keydown', keyboard)
  }, [arranging, confirmExit, focused, helpOpen, inventoryOpen, paused, settingsOpen, traderOpen])
  const interact = useCallback(() => {
    if (!nearby || paused) return
    document.exitPointerLock?.(); setFocused(nearby); setPaused(true)
  }, [nearby, paused])
  const parcels = preview.parcel ? [preview.parcel] : (data?.parcels || [])
  const readyParcel = useMemo(() => parcels.find(parcel => parcel.status === 'ready'), [parcels])
  const worldParcel = useMemo(() => parcels.find(parcel => ['ready', 'collected', 'placed'].includes(parcel.status)), [parcels])
  const focusKind = focused?.interactive
  const promptTarget = preview.traderProof === 'prompt' ? DEV_FOCUS.door : nearby
  const closePanel = () => { deselectPlacement.current?.(); setFocused(null); setInspectTilt({ x: 0, y: 0 }); setArranging(false); setPlacementInstanceId(null); setPlacementPreview(null); setWorldSample(null); setPaused(false) }
  const openInventory = (tab = 'cards') => {
    document.exitPointerLock?.()
    setFocused(null); setArranging(false); setPlacementInstanceId(null); setPaused(true)
    setInventoryTab(tab); setInventoryOpen(true)
  }
  const openFurniturePlacement = instanceId => { setInventoryOpen(false); setPlacementInstanceId(instanceId); setFocused(null); setArranging(true); setPaused(false) }
  useEffect(() => {
    if (focusKind !== 'door' || traderOpen) return
    setDoorTransition(true)
    const timer = window.setTimeout(() => { setTraderOpen(true); setDoorTransition(false) }, 900)
    return () => window.clearTimeout(timer)
  }, [focusKind, traderOpen])
  const closeTrader = () => { setTraderOpen(false); setDoorTransition(false); setFocused(null); setPaused(true) }
  useEffect(() => {
    const readyIds = new Set(parcels.filter(parcel => parcel.status === 'ready').map(parcel => parcel.id))
    if (readySeen.current && [...readyIds].some(id => !readySeen.current.has(id))) {
      try {
        const AudioContext = window.AudioContext || window.webkitAudioContext
        const audio = new AudioContext(); const tone = audio.createOscillator(); const gain = audio.createGain()
        tone.frequency.value = 620; gain.gain.setValueAtTime(.035, audio.currentTime); gain.gain.exponentialRampToValueAtTime(.001, audio.currentTime + .35)
        tone.connect(gain); gain.connect(audio.destination); tone.start(); tone.stop(audio.currentTime + .35)
      } catch { /* Browser audio may remain muted until the next room gesture. */ }
    }
    readySeen.current = readyIds
  }, [parcels])

  if (isError) return <main className="tcg-room tcg-room--fallback"><div className="tcg-room__fatal"><strong>Room state unavailable</strong><p>{error?.response?.data?.detail || 'The collection room could not load its saved state.'}</p><button onClick={() => refetch()}>Retry</button><button onClick={() => navigate('/collection')}>Exit room</button></div></main>

  return <main className={`tcg-room ${proofCardId ? 'tcg-room--proof' : ''}${sceneReady ? '' : ' tcg-room--booting'}`} style={{ background: '#12111a' }}>
    <div style={{ position: 'absolute', inset: 0, visibility: sceneReady ? 'visible' : 'hidden' }}>
      <RoomCanvasBoundary><RoomScene version={version} quality={quality} paused={paused} focused={focused} arranging={arranging} parcel={worldParcel} parcels={parcels} bootstrap={roomData} placementPreview={placementPreview} visibleCards={sceneVisibleCards} onVisibleCards={setVisibleCardCount} onNearby={setNearby} onInteract={interact} onMetrics={setMetrics} onLoaded={setLoadedAssets} onWorldSample={setWorldSample} onLockPlacement={() => lockPlacement.current?.()} onConfirmPlacement={() => confirmPlacement.current?.()} onReturnPlacement={() => returnPlacement.current?.()} onRotatePlacement={() => rotatePlacement.current?.()} onSelectPlaced={id => { if (!placementPreview) setPlacementInstanceId(id) }} onDeselectPlacement={() => deselectPlacement.current?.()} /></RoomCanvasBoundary>
    </div>
    {!sceneReady && <div className="tcg-room__boot" role="status" style={{ position: 'absolute', inset: 0, zIndex: 40, display: 'grid', placeContent: 'center', background: '#12111a' }}><i className="tcg-room__boot-mark" /></div>}
    {sceneReady && !arranging && <div className="tcg-room__reticle" aria-hidden="true" />}
    {sceneReady && focusKind !== 'computer' && <div className="vault-hud">
      <div className="vault-hud__brand">
        <img src="/logo.png" alt="" />
        <div><strong>THE VAULT</strong><small>TCG MINIGAME</small></div>
        <button type="button" className="vault-hud__exit" onClick={() => { document.exitPointerLock?.(); setPaused(true); setConfirmExit(true) }}><ArrowLeft size={16} /> Exit Room</button>
      </div>
      <div className="vault-hud__title">COLLECTION ROOM - {version}</div>
      <div className="vault-hud__actions">
        <button type="button" onClick={() => openInventory('cards')}><Home size={16} /> Room Menu</button>
        <button type="button" onClick={() => { document.exitPointerLock?.(); setPaused(true); setSettingsOpen(true) }}><Settings2 size={16} /> Settings</button>
        <button type="button" onClick={() => { document.exitPointerLock?.(); setPaused(true); setHelpOpen(true) }}><CircleHelp size={16} /> Controls</button>
      </div>
      {(!inventoryOpen || inventoryTab === 'packs') && !focused && !arranging && <div className="vault-hud__summary">
        <h3>Inventory Summary</h3>
        <div>
          <article><PackageOpen size={18} /><strong>{Number(ownedCatalog?.total || 0).toLocaleString()}</strong><span>Total Cards</span></article>
          <article><Box size={18} /><strong>{Number((inventorySummary?.counts?.pack_tokens || 0) + (inventorySummary?.parcels || []).reduce((sum, row) => sum + Number(row.pack_count || 0), 0) + parcels.filter(parcel => ['mailed', 'ready'].includes(parcel.status)).reduce((sum, parcel) => sum + (parcel.contents || []).reduce((inner, line) => inner + Number(line.quantity || 0), 0), 0)).toLocaleString()}</strong><span>Unopened Packs</span></article>
          <article><Home size={18} /><strong>{Number(inventorySummary?.counts?.furniture || furniture?.owned_instances?.length || 0).toLocaleString()}</strong><span>Furniture Items</span></article>
        </div>
      </div>}
    </div>}
    {sceneReady && !paused && promptTarget?.copy && <button className="tcg-room__prompt" onClick={interact}><kbd>E</kbd><span><strong>{promptTarget.copy[0]}</strong><small>{promptTarget.copy[1]}</small></span></button>}
    {sceneReady && paused && !focused && !arranging && !inventoryOpen && !confirmExit && !helpOpen && !settingsOpen && <button type="button" className="vault-hud__resume" onClick={() => setPaused(false)}>Click to explore · WASD · E interact · I inventory · Tab placement</button>}
    {confirmExit && <section className="tcg-room__exit-confirm" role="dialog" aria-modal="true" aria-labelledby="room-exit-title"><div><h2 id="room-exit-title">Leave your room?</h2><p>Your layout is saved. Closing a menu or pressing Escape never exits the room.</p><button className="primary" onClick={() => navigate('/collection')}>Yes, exit to collection</button><button onClick={() => { setConfirmExit(false); setPaused(false) }}>No, return to room</button></div></section>}
    {inventoryOpen && <RoomInventory initialTab={inventoryTab} onTabChange={setInventoryTab} onClose={() => { setInventoryOpen(false); setPaused(false) }} onPlaceFurniture={openFurniturePlacement} />}
    {arranging && <RoomLayoutPanel bootstrap={roomData} initialInstanceId={placementInstanceId} worldSample={worldSample} onPreview={setPlacementPreview} onConfirmReady={fn => { confirmPlacement.current = fn }} onLockReady={fn => { lockPlacement.current = fn || (() => {}) }} onDeselectReady={fn => { deselectPlacement.current = fn }} onActionsReady={actions => { returnPlacement.current = actions?.returnToInventory || (() => {}); rotatePlacement.current = actions?.rotate || (() => {}) }} onExit={closePanel} />}
    {focused?.interactive === 'card-inspect' && focused.card && <section className="tcg-room__card-inspector" onMouseMove={event => {
      const box = event.currentTarget.getBoundingClientRect()
      setInspectTilt({ x: ((event.clientY - box.top) / box.height - .5) * -18, y: ((event.clientX - box.left) / box.width - .5) * 24 })
    }}>
      <button className="close" onClick={closePanel}><X size={22} /> Put card back</button>
      <div className="tcg-room__card-inspector-art" style={{ transform: `rotateX(${inspectTilt.x}deg) rotateY(${inspectTilt.y}deg)` }}>
        <TCGV2CardFace card={focused.card} width={Math.min(520, Math.max(300, window.innerWidth * .38))} showEffects />
      </div>
      <strong>{focused.card.display_name || focused.card.name || 'Card inspection'}</strong>
      <span>Move your pointer across the card to rotate it · Esc to put it back</span>
    </section>}
    {focused && !['door', 'card-inspect'].includes(focusKind) && <section className={`tcg-room__focus-panel ${focusKind === 'computer' ? 'tcg-room__computer-screen' : ''} ${focusKind === 'binder' ? 'wide' : ''}`}>
      <button className="close" onClick={closePanel}><X size={22} /> Return to room</button>
      {focusKind !== 'computer' && <><h2>{focused?.copy?.[0] || 'Room interaction'}</h2><p>{focused?.copy?.[1]}</p></>}
      {focusKind === 'computer' && <RoomDeviceSurface roomBootstrap={roomData} />}
      {['mail', 'parcel'].includes(focusKind) && <RoomParcelPanel parcels={parcels} context={focusKind} suggestedSurface={focused?.parcelAnchor} onCollected={() => openInventory('packs')} />}
      {focusKind === 'pile' && <RoomCopyManager context="pile" />}
      {['display', 'poster'].includes(focusKind) && <RoomDisplayManager context={focusKind} bootstrap={roomData} instanceId={focused?.instanceId} />}
    </section>}
    {doorTransition && <section className="tcg-room__door-transition"><DoorOpen size={44} /><span>VISIT TRADER</span><strong>Approaching the door…</strong><p>Your room is staying exactly where you left it.</p></section>}
    {traderOpen && <TraderVN onClose={closeTrader} />}
    {readyParcel && <div className="tcg-room__delivery"><Box size={22} /><span><strong>Delivery arrived</strong>Packs are on the table.</span></div>}
    {carriedCopies.length > 0 && <div className="tcg-room__held tcg-room__held--cards" aria-label={`Carrying ${carriedCopies.length} physical cards`}><span>{carriedCopies.length}</span><strong>physical cards held</strong></div>}
    {perfOpen && <PerformanceOverlay metrics={metrics} quality={quality} visibleCards={visibleCardCount} loadedAssets={loadedAssets} />}
    {helpOpen && <section className="vault-hud__modal" role="dialog" aria-labelledby="room-controls-title"><div><h2 id="room-controls-title">Controls</h2><dl className="vault-hud__controls-list">
      {[
        ['WASD', 'Movement'],
        ['Mouse', 'Look'],
        ['E', 'Interact'],
        ['I', 'Inventory'],
        ['Tab', 'Placement mode'],
        ['Left click', 'Select / lock placement'],
        ['Q / E', 'Rotate furniture'],
        ['Mouse wheel', 'Rotate furniture / scroll items'],
        ['Right mouse', 'Look / deselect placement'],
        ['C', 'Crouch'],
        ['Esc', 'Close'],
      ].map(([key, label]) => <div key={key}><dt>{key}</dt><dd>{label}</dd></div>)}
    </dl><button type="button" onClick={() => { setHelpOpen(false); setPaused(false) }}>Close</button></div></section>}
    {settingsOpen && <section className="vault-hud__modal" role="dialog"><div><h2>Settings</h2><label>Graphics quality<select value={quality} onChange={event => setQuality(event.target.value)}><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select></label><button type="button" onClick={() => { setSettingsOpen(false); setPaused(false) }}>Close</button></div></section>}
    {proofCard && <aside className="tcg-room__proof-card"><strong>{proofCard.dev_fixture ? 'DEV-only visual fixture' : 'Persisted physical card proof'}</strong><span>Copy {proofCard.copy.id} · Card {proofCard.preview.card_id}</span><span>{proofCard.preview.card_type} · {proofCard.preview.rarity} · packed mask {proofCard.card?.mask_url ? 'loaded' : 'not required'}</span></aside>}
    {proofCard?.card && <aside className="tcg-room__proof-reference"><strong>Authoritative 2D reference</strong><TCGV2CardFace card={proofCard.card} width={250} showEffects={false} /></aside>}
    {sceneReady && !data && <div className="tcg-room__loading">Loading saved room state...</div>}
  </main>
}

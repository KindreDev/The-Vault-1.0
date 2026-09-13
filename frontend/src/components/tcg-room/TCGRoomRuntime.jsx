import { Component, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, BarChart3, Box, DoorOpen, Gauge, LayoutDashboard, PackageOpen, Settings2, X } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { cardsApi, tcgRoomApi } from '../../lib/api'
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
  parcel: { interactive: 'parcel', position: [3.02, .93, -.8], copy: ['Open parcel', 'Manually unseal the placed delivery before revealing packs'] },
  door: { interactive: 'door', position: [3.06, 1.1, 4.89], copy: ['Visit trader', "Step outside to meet this week's visitor"] },
})

function isTextEntryTarget(target) {
  const element = typeof Element !== 'undefined' && target instanceof Element ? target : null
  return Boolean(element && (['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName) || element.isContentEditable || element.closest('[contenteditable="true"]')))
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
  const [paused, setPaused] = useState(preview.traderProof === 'prompt' ? false : true)
  const [nearby, setNearby] = useState(null)
  const [focused, setFocused] = useState(preview.focus)
  const [arranging, setArranging] = useState(false)
  const [inventoryOpen, setInventoryOpen] = useState(false)
  const [placementInstanceId, setPlacementInstanceId] = useState(null)
  const [placementPreview, setPlacementPreview] = useState(null)
  const [worldSample, setWorldSample] = useState(null)
  const confirmPlacement = useRef(() => {})
  const [doorTransition, setDoorTransition] = useState(false)
  const [traderOpen, setTraderOpen] = useState(false)
  const [quality, setQuality] = useState(() => localStorage.getItem('vault.tcg-room.quality') || 'medium')
  const [diagnostics, setDiagnostics] = useState(false)
  const [confirmExit, setConfirmExit] = useState(false)
  const [metrics, setMetrics] = useState({ frameMs: 0, calls: 0, triangles: 0, textures: 0, geometries: 0 })
  const [loadedAssets, setLoadedAssets] = useState(0)
  const [sceneReady, setSceneReady] = useState(false)
  const [visibleCardCount, setVisibleCardCount] = useState(0)
  const readySeen = useRef(null)
  const { data, isError, error, refetch } = useQuery({ queryKey: ['tcg-room-bootstrap'], queryFn: () => tcgRoomApi.bootstrap().then(r => r.data), refetchInterval: 3000 })
  const { data: furniture } = useQuery({ queryKey: ['tcg-room-furniture'], queryFn: () => tcgRoomApi.furniture().then(r => r.data), refetchInterval: 3000 })
  const roomData = useMemo(() => furniture ? { ...data, ...furniture, room: data?.room } : data, [data, furniture])
  const { data: carriedCopies = [] } = useQuery({ queryKey: ['tcg-room-copies', 'carried'], queryFn: () => tcgRoomApi.copies({ location_kind: 'carried' }).then(r => r.data), refetchInterval: 3000 })
  const { data: visibleCards = { items: [], counts: {} } } = useQuery({ queryKey: ['tcg-room-visible-cards'], queryFn: () => tcgRoomApi.visibleCards().then(r => r.data), refetchInterval: 3000 })
  const proofParams = import.meta.env.DEV ? new URLSearchParams(window.location.search) : null
  const fixtureCardId = Number(proofParams?.get('roomCardFixture') || 0)
  const proofCardId = Number(proofParams?.get('roomCardProof') || fixtureCardId || 0)
  const { data: fixtureCard = null } = useQuery({
    queryKey: ['tcg-room-dev-card-fixture', fixtureCardId],
    queryFn: () => cardsApi.get(fixtureCardId).then(r => r.data),
    enabled: import.meta.env.DEV && fixtureCardId > 0,
    staleTime: Infinity,
  })
  const fixtureItem = useMemo(() => fixtureCard ? {
    copy: { id: `dev-fixture-${fixtureCard.id}`, location_kind: 'display_stand' },
    surface: 'display', material_ready: true, card: fixtureCard,
    preview: { card_id: fixtureCard.id, rarity: fixtureCard.rarity_class, card_type: fixtureCard.card_type, title: fixtureCard.display_name },
    dev_fixture: true,
  } : null, [fixtureCard])
  const sceneVisibleCards = fixtureItem ? { items: [fixtureItem], counts: { rendered: 1, preparing: 0 } } : visibleCards
  const proofCard = proofCardId ? sceneVisibleCards.items.find(item => Number(item.preview?.card_id) === proofCardId) : null

  useEffect(() => { localStorage.setItem('vault.tcg-room.quality', quality) }, [quality])
  useEffect(() => {
    if (loadedAssets > 0 && data) setSceneReady(true)
  }, [data, loadedAssets])
  useEffect(() => {
    const keyboard = event => {
      if (event.code === 'KeyI' && !isTextEntryTarget(event.target)) {
        event.preventDefault()
        if (inventoryOpen) { setInventoryOpen(false); return }
        if (confirmExit || traderOpen) return
        document.exitPointerLock?.()
        setFocused(null); setArranging(false); setPlacementInstanceId(null); setPaused(true); setInventoryOpen(true)
        return
      }
      if (event.code !== 'Escape') return
      if (inventoryOpen) { setInventoryOpen(false); return }
      if (confirmExit) { setConfirmExit(false); return }
      if (traderOpen) { setTraderOpen(false); setDoorTransition(false); setFocused(null); setPaused(true); return }
      if (focused || arranging) { setFocused(null); setArranging(false); setPaused(false); return }
      if (diagnostics) { setDiagnostics(false); return }
      if (!paused) { document.exitPointerLock?.(); setPaused(true) }
    }
    window.addEventListener('keydown', keyboard)
    return () => window.removeEventListener('keydown', keyboard)
  }, [arranging, confirmExit, diagnostics, focused, inventoryOpen, paused, traderOpen])
  const interact = useCallback(() => {
    if (!nearby || paused) return
    document.exitPointerLock?.(); setFocused(nearby); setPaused(true)
  }, [nearby, paused])
  const parcels = preview.parcel ? [preview.parcel] : (data?.parcels || [])
  const readyParcel = useMemo(() => parcels.find(parcel => parcel.status === 'ready'), [parcels])
  const worldParcel = useMemo(() => parcels.find(parcel => ['ready', 'collected', 'placed'].includes(parcel.status)), [parcels])
  const focusKind = focused?.interactive
  const promptTarget = preview.traderProof === 'prompt' ? DEV_FOCUS.door : nearby
  const closePanel = () => { setFocused(null); setArranging(false); setPlacementInstanceId(null); setPlacementPreview(null); setWorldSample(null); setPaused(false) }
  const openInventory = () => { document.exitPointerLock?.(); setFocused(null); setArranging(false); setPlacementInstanceId(null); setPaused(true); setInventoryOpen(true) }
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
      <RoomCanvasBoundary><RoomScene version={version} quality={quality} paused={paused} focused={focused} arranging={arranging} parcel={worldParcel} bootstrap={roomData} placementPreview={placementPreview} visibleCards={sceneVisibleCards} onVisibleCards={setVisibleCardCount} onNearby={setNearby} onInteract={interact} onMetrics={setMetrics} onLoaded={setLoadedAssets} onWorldSample={setWorldSample} onConfirmPlacement={() => confirmPlacement.current?.()} onSelectPlaced={id => setPlacementInstanceId(id)} /></RoomCanvasBoundary>
    </div>
    {!sceneReady && <div className="tcg-room__boot" role="status" style={{ position: 'absolute', inset: 0, zIndex: 40, display: 'grid', placeContent: 'center', justifyItems: 'center', gap: 10, background: '#12111a', color: '#fff', textAlign: 'center' }}><span>COLLECTION ROOM</span><strong>Preparing your room</strong><p>Meshes and materials are still loading. This screen stays up until the space is actually ready.</p></div>}
    {sceneReady && !arranging && <div className="tcg-room__reticle" aria-hidden="true" />}
    {sceneReady && <div className="tcg-room__top-hud">
      <button onClick={() => { document.exitPointerLock?.(); setPaused(true); setConfirmExit(true) }}><ArrowLeft size={20} /> Exit room</button>
      <span>COLLECTION ROOM - {version}</span>
      <div><button onClick={openInventory}><PackageOpen size={19} /> Inventory <kbd>I</kbd></button><button onClick={() => { document.exitPointerLock?.(); setFocused(null); setPaused(false); setArranging(true) }}><LayoutDashboard size={19} /> Placement Mode</button><button onClick={() => setDiagnostics(value => !value)}><BarChart3 size={19} /> Diagnostics</button></div>
    </div>}
    {sceneReady && !paused && promptTarget?.copy && <button className="tcg-room__prompt" onClick={interact}><kbd>E</kbd><span><strong>{promptTarget.copy[0]}</strong><small>{promptTarget.copy[1]}</small></span></button>}
    {sceneReady && paused && !focused && !arranging && !inventoryOpen && !confirmExit && <section className="tcg-room__pause"><div><span>PRIVATE COLLECTION</span><h1>Your room</h1><p>Click resume, then use WASD and the mouse to explore. Look at an object and press E to interact.</p><button className="primary" onClick={() => setPaused(false)}>Resume exploring</button><label><Settings2 size={20} /> Graphics quality<select value={quality} onChange={event => setQuality(event.target.value)}><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select></label></div></section>}
    {confirmExit && <section className="tcg-room__exit-confirm" role="dialog" aria-modal="true" aria-labelledby="room-exit-title"><div><h2 id="room-exit-title">Leave your room?</h2><p>Your layout is saved. Closing a menu or pressing Escape never exits the room.</p><button className="primary" onClick={() => navigate('/collection')}>Yes, exit to collection</button><button onClick={() => { setConfirmExit(false); setPaused(false) }}>No, return to room</button></div></section>}
    {inventoryOpen && <RoomInventory onClose={() => setInventoryOpen(false)} onPlaceFurniture={openFurniturePlacement} />}
    {arranging && <RoomLayoutPanel bootstrap={roomData} initialInstanceId={placementInstanceId} worldSample={worldSample} onPreview={setPlacementPreview} onConfirmReady={fn => { confirmPlacement.current = fn }} onExit={closePanel} />}
    {focused && focusKind !== 'door' && <section className={`tcg-room__focus-panel ${focusKind === 'computer' ? 'tcg-room__computer-screen' : ''} ${focusKind === 'binder' ? 'wide' : ''}`}>
      <button className="close" onClick={closePanel}><X size={22} /> Return to room</button>
      {focusKind !== 'computer' && <><h2>{focused?.copy?.[0] || 'Room interaction'}</h2><p>{focused?.copy?.[1]}</p></>}
      {focusKind === 'computer' && <RoomDeviceSurface roomBootstrap={roomData} />}
      {['mail', 'parcel'].includes(focusKind) && <RoomParcelPanel parcels={parcels} context={focusKind} suggestedSurface={focused?.parcelAnchor} />}
      {focusKind === 'pile' && <RoomCopyManager context="pile" />}
      {['cabinet', 'display', 'poster'].includes(focusKind) && <RoomDisplayManager context={focusKind} bootstrap={data} />}
    </section>}
    {doorTransition && <section className="tcg-room__door-transition"><DoorOpen size={44} /><span>VISIT TRADER</span><strong>Approaching the door…</strong><p>Your room is staying exactly where you left it.</p></section>}
    {traderOpen && <TraderVN onClose={closeTrader} />}
    {readyParcel && <div className="tcg-room__delivery"><Box size={22} /><span><strong>Delivery arrived</strong>Booster packs dropped in the blue box on the table.</span></div>}
    {carriedCopies.length > 0 && <div className="tcg-room__held tcg-room__held--cards" aria-label={`Carrying ${carriedCopies.length} physical cards`}><span>{carriedCopies.length}</span><strong>physical cards held</strong></div>}
    {diagnostics && <aside className="tcg-room__diagnostics"><button className="tcg-room__diagnostics-close" onClick={() => setDiagnostics(false)}><X size={18} /> Close diagnostics</button><strong><Gauge size={18} /> Room diagnostics</strong><span>Average frame {metrics.frameMs} ms</span><span>Draw calls {metrics.calls}</span><span>Triangles {metrics.triangles.toLocaleString()}</span><span>Textures {metrics.textures}</span><span>Geometry {metrics.geometries}</span><span>Resident scene assets {loadedAssets}</span><span>Visible cards {visibleCardCount}</span><span>Preparing foil {visibleCards.counts?.preparing || 0}</span></aside>}
    {proofCard && <aside className="tcg-room__proof-card"><strong>{proofCard.dev_fixture ? 'DEV-only visual fixture' : 'Persisted physical card proof'}</strong><span>Copy {proofCard.copy.id} · Card {proofCard.preview.card_id}</span><span>{proofCard.preview.card_type} · {proofCard.preview.rarity} · packed mask {proofCard.card?.mask_url ? 'loaded' : 'not required'}</span></aside>}
    {proofCard?.card && <aside className="tcg-room__proof-reference"><strong>Authoritative 2D reference</strong><TCGV2CardFace card={proofCard.card} width={250} showEffects={false} /></aside>}
    {sceneReady && !data && <div className="tcg-room__loading">Loading saved room state...</div>}
  </main>
}

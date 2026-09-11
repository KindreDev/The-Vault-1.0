import { Component, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, BarChart3, Box, DoorOpen, Gauge, LayoutDashboard, Settings2, X } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { cardsApi, tcgRoomApi } from '../../lib/api'
import RoomScene from './RoomScene'
import RoomDeviceSurface from './RoomDeviceSurface'
import RoomParcelPanel from './RoomParcelPanel'
import RoomCopyManager from './RoomCopyManager'
import RoomDisplayManager from './RoomDisplayManager'
import RoomLayoutPanel from './RoomLayoutPanel'
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
  computer: { interactive: 'computer', position: [3.8, .78, -3.92], copy: ['Use computer', 'Browse the real TCG collection and order packs online'] },
  binder: { interactive: 'binder', position: [-.3, .82, -4.0], copy: ['Open binder', 'Manage the same binder used by the 2D collection'] },
  parcel: { interactive: 'parcel', position: [2.0, .86, 2.75], copy: ['Open parcel', 'Manually unseal the placed delivery before revealing packs'] },
  door: { interactive: 'door', position: [-5.91, 1.1, 0], copy: ['Visit trader', "Step outside to meet this week's visitor"] },
})

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
  const [placementPreview, setPlacementPreview] = useState(null)
  const [doorTransition, setDoorTransition] = useState(false)
  const [traderOpen, setTraderOpen] = useState(false)
  const [quality, setQuality] = useState(() => localStorage.getItem('vault.tcg-room.quality') || 'medium')
  const [diagnostics, setDiagnostics] = useState(false)
  const [confirmExit, setConfirmExit] = useState(false)
  const [metrics, setMetrics] = useState({ frameMs: 0, calls: 0, triangles: 0, textures: 0, geometries: 0 })
  const [loadedAssets, setLoadedAssets] = useState(0)
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
    const escape = event => {
      if (event.code !== 'Escape') return
      if (confirmExit) { setConfirmExit(false); return }
      if (traderOpen) { setTraderOpen(false); setDoorTransition(false); setFocused(null); setPaused(true); return }
      if (focused || arranging) { setFocused(null); setArranging(false); setPaused(false); return }
      if (diagnostics) { setDiagnostics(false); return }
      if (!paused) { document.exitPointerLock?.(); setPaused(true) }
    }
    window.addEventListener('keydown', escape)
    return () => window.removeEventListener('keydown', escape)
  }, [arranging, confirmExit, diagnostics, focused, paused, traderOpen])
  const interact = useCallback(() => {
    if (!nearby || paused) return
    document.exitPointerLock?.(); setFocused(nearby); setPaused(true)
  }, [nearby, paused])
  const parcels = preview.parcel ? [preview.parcel] : (data?.parcels || [])
  const readyParcel = useMemo(() => parcels.find(parcel => parcel.status === 'ready'), [parcels])
  const carriedParcel = useMemo(() => parcels.find(parcel => parcel.status === 'collected'), [parcels])
  const focusKind = focused?.interactive
  const promptTarget = preview.traderProof === 'prompt' ? DEV_FOCUS.door : nearby
  const closePanel = () => { setFocused(null); setArranging(false); setPlacementPreview(null); setPaused(false) }
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

  return <main className={`tcg-room ${proofCardId ? 'tcg-room--proof' : ''}`}>
    <RoomCanvasBoundary><RoomScene version={version} quality={quality} paused={paused} focused={focused} parcel={parcels[0]} bootstrap={roomData} placementPreview={placementPreview} visibleCards={sceneVisibleCards} onVisibleCards={setVisibleCardCount} onNearby={setNearby} onInteract={interact} onMetrics={setMetrics} onLoaded={setLoadedAssets} /></RoomCanvasBoundary>
    <div className="tcg-room__reticle" aria-hidden="true" />
    <div className="tcg-room__top-hud">
      <button onClick={() => { document.exitPointerLock?.(); setPaused(true); setConfirmExit(true) }}><ArrowLeft size={20} /> Exit room</button>
      <span>COLLECTION ROOM - {version}</span>
      <div><button onClick={() => { document.exitPointerLock?.(); setPaused(true); setArranging(true) }}><LayoutDashboard size={19} /> Placement Mode</button><button onClick={() => setDiagnostics(value => !value)}><BarChart3 size={19} /> Diagnostics</button></div>
    </div>
    {!paused && promptTarget?.copy && <button className="tcg-room__prompt" onClick={interact}><kbd>E</kbd><span><strong>{promptTarget.copy[0]}</strong><small>{promptTarget.copy[1]}</small></span></button>}
    {paused && !focused && !arranging && !confirmExit && <section className="tcg-room__pause"><div><span>PRIVATE COLLECTION</span><h1>Your room</h1><p>Click resume, then use WASD and the mouse to explore. Look at an object and press E to interact.</p><button className="primary" onClick={() => setPaused(false)}>Resume exploring</button><label><Settings2 size={20} /> Graphics quality<select value={quality} onChange={event => setQuality(event.target.value)}><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select></label></div></section>}
    {confirmExit && <section className="tcg-room__exit-confirm" role="dialog" aria-modal="true" aria-labelledby="room-exit-title"><div><h2 id="room-exit-title">Leave your room?</h2><p>Your layout is saved. Closing a menu or pressing Escape never exits the room.</p><button className="primary" onClick={() => navigate('/collection')}>Yes, exit to collection</button><button onClick={() => { setConfirmExit(false); setPaused(false) }}>No, return to room</button></div></section>}
    {(focused || arranging) && focusKind !== 'door' && <section className={`tcg-room__focus-panel ${arranging ? 'tcg-room__placement-panel' : ''} ${focusKind === 'computer' ? 'tcg-room__computer-screen' : ''} ${focusKind === 'binder' ? 'wide' : ''}`}>
      <button className="close" onClick={closePanel}><X size={22} /> Return to room</button>
      {arranging ? <RoomLayoutPanel bootstrap={roomData} onPreview={setPlacementPreview} /> : <>{focusKind !== 'computer' && <><h2>{focused?.copy?.[0] || 'Room interaction'}</h2><p>{focused?.copy?.[1]}</p></>}
        {focusKind === 'computer' && <RoomDeviceSurface roomBootstrap={roomData} />}
        {focusKind === 'binder' && <RoomDeviceSurface initialTab="binders" roomBootstrap={roomData} />}
        {['mail', 'parcel', 'parcel-place'].includes(focusKind) && <RoomParcelPanel parcels={parcels} context={focusKind} suggestedSurface={focused?.parcelAnchor} />}
        {focusKind === 'pile' && <RoomCopyManager context="pile" />}
        {['cabinet', 'display', 'poster'].includes(focusKind) && <RoomDisplayManager context={focusKind} bootstrap={data} />}
      </>}
    </section>}
    {doorTransition && <section className="tcg-room__door-transition"><DoorOpen size={44} /><span>VISIT TRADER</span><strong>Approaching the door…</strong><p>Your room is staying exactly where you left it.</p></section>}
    {traderOpen && <TraderVN onClose={closeTrader} />}
    {readyParcel && <div className="tcg-room__delivery"><Box size={22} /><span><strong>Parcel delivered</strong>Check the mail slot by the door.</span></div>}
    {carriedParcel && <div className="tcg-room__held" aria-label={`Carrying parcel ${carriedParcel.id}`}><Box size={34} /><span>Parcel {carriedParcel.id}</span></div>}
    {!carriedParcel && carriedCopies.length > 0 && <div className="tcg-room__held tcg-room__held--cards" aria-label={`Carrying ${carriedCopies.length} physical cards`}><span>{carriedCopies.length}</span><strong>physical cards held</strong></div>}
    {diagnostics && <aside className="tcg-room__diagnostics"><button className="tcg-room__diagnostics-close" onClick={() => setDiagnostics(false)}><X size={18} /> Close diagnostics</button><strong><Gauge size={18} /> Room diagnostics</strong><span>Average frame {metrics.frameMs} ms</span><span>Draw calls {metrics.calls}</span><span>Triangles {metrics.triangles.toLocaleString()}</span><span>Textures {metrics.textures}</span><span>Geometry {metrics.geometries}</span><span>Resident scene assets {loadedAssets}</span><span>Visible cards {visibleCardCount}</span><span>Preparing foil {visibleCards.counts?.preparing || 0}</span></aside>}
    {proofCard && <aside className="tcg-room__proof-card"><strong>{proofCard.dev_fixture ? 'DEV-only visual fixture' : 'Persisted physical card proof'}</strong><span>Copy {proofCard.copy.id} · Card {proofCard.preview.card_id}</span><span>{proofCard.preview.card_type} · {proofCard.preview.rarity} · packed mask {proofCard.card?.mask_url ? 'loaded' : 'not required'}</span></aside>}
    {proofCard?.card && <aside className="tcg-room__proof-reference"><strong>Authoritative 2D reference</strong><TCGV2CardFace card={proofCard.card} width={250} showEffects={false} /></aside>}
    {!data && <div className="tcg-room__loading">Loading saved room state...</div>}
  </main>
}

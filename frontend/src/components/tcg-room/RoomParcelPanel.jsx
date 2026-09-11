import { useEffect, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Box, Hand, MapPin, PackageOpen } from 'lucide-react'
import { tcgRoomApi, tcgV2Api } from '../../lib/api'
import PackOpening from '../PackOpening'

const SURFACES = ['desk', 'dining_table', 'bed', 'sorting_mat', 'shelf', 'storage_area']

export default function RoomParcelPanel({ parcels, context, suggestedSurface }) {
  const qc = useQueryClient()
  const [surface, setSurface] = useState('sorting_mat')
  const [tearing, setTearing] = useState(false)
  const [openedPacks, setOpenedPacks] = useState(null)
  const [revealError, setRevealError] = useState('')
  const tearTimer = useRef(null)
  useEffect(() => {
    if (suggestedSurface && SURFACES.includes(suggestedSurface)) setSurface(suggestedSurface)
  }, [suggestedSurface])
  useEffect(() => () => window.clearTimeout(tearTimer.current), [])
  const parcel = context === 'mail'
    ? parcels.find(item => item.status === 'ready')
    : context === 'parcel-place' ? parcels.find(item => item.status === 'collected')
      : parcels.find(item => ['ready', 'collected', 'placed'].includes(item.status))
  const refresh = () => qc.invalidateQueries({ queryKey: ['tcg-room-bootstrap'] })
  const action = useMutation({
    mutationFn: ({ kind, id }) => kind === 'collect' ? tcgRoomApi.collectParcel(id) : kind === 'place' ? tcgRoomApi.placeParcel(id, { transform: {}, snap_anchor: surface }) : tcgRoomApi.openParcel(id),
    onSuccess: async (response, variables) => {
      refresh()
      if (variables.kind === 'open') {
        try {
          const products = new Map((response.data.contents || []).map(line => [line.product_id, line.product]))
          const packs = await Promise.all((response.data.results || []).map(async result => ({
            product: products.get(result.product_id) || {},
            cards: await Promise.all(result.cards.map(id => tcgV2Api.cardDetail(id).then(cardResponse => cardResponse.data.card))),
          })))
          setRevealError('')
          setOpenedPacks(packs)
          qc.invalidateQueries({ queryKey: ['tcg-room-copies'] })
          qc.invalidateQueries({ queryKey: ['tcg-v2-catalog'] })
          toast.success('Masks are ready. Tear the first pack to reveal your cards.')
        } catch (error) {
          setRevealError(error.response?.data?.detail || 'The parcel opened safely, but its reveal could not load. Retry the reveal from Collection.')
        }
      } else {
        toast.success(variables.kind === 'collect' ? 'Parcel collected' : `Parcel placed on ${surface.replaceAll('_', ' ')}`)
      }
    },
    onError: error => toast.error(error.response?.data?.detail || 'Parcel action failed'),
  })
  const beginTear = () => { setTearing(true); tearTimer.current = window.setTimeout(() => action.mutate({ kind: 'open', id: parcel.id }), 1100) }
  const cancelTear = () => { window.clearTimeout(tearTimer.current); setTearing(false) }
  if (openedPacks) return <PackOpening packs={openedPacks} onCollect={() => setOpenedPacks(null)} onSkip={() => setOpenedPacks(null)} />
  if (!parcel) return <div className="tcg-room-empty"><Box size={28} /><strong>No parcel here</strong><span>Orders arrive after their persisted delivery timer finishes.</span></div>
  return <div className="tcg-room-parcel">
    <div className="tcg-room-parcel__box"><Box size={42} /><span>PARCEL {parcel.id}</span></div>
    <dl><div><dt>Status</dt><dd>{parcel.status}</dd></div><div><dt>Paid</dt><dd>{Number(parcel.total_price).toLocaleString()} Credits</dd></div><div><dt>Sealed products</dt><dd>{parcel.contents?.length || 0}</dd></div></dl>
    {parcel.status === 'ready' && <button className="primary" disabled={action.isPending} onClick={() => action.mutate({ kind: 'collect', id: parcel.id })}><Hand size={19} /> Pick up parcel</button>}
    {parcel.status === 'collected' && <><label>Place on<select value={surface} onChange={event => setSurface(event.target.value)}>{SURFACES.map(item => <option key={item} value={item}>{item.replaceAll('_', ' ')}</option>)}</select></label><button className="primary" disabled={action.isPending} onClick={() => action.mutate({ kind: 'place', id: parcel.id })}><MapPin size={19} /> Place parcel</button></>}
    {parcel.status === 'placed' && <button className={`primary tcg-room-parcel__tear ${tearing ? 'tearing' : ''}`} disabled={action.isPending} onPointerDown={beginTear} onPointerUp={cancelTear} onPointerLeave={cancelTear}><PackageOpen size={19} /> {action.isPending ? 'Preparing masks and opening...' : tearing ? 'Keep holding to unseal...' : 'Hold to unseal parcel'}<i /></button>}
    {revealError && <div className="tcg-room__error" role="alert">{revealError}</div>}
  </div>
}

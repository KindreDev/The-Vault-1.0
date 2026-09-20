import { useEffect, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { PackageOpen } from 'lucide-react'
import { tcgRoomApi, tcgV2Api } from '../../lib/api'
import PackOpening from '../PackOpening'

const WRAPPERS = {
  permanent: '/tcg-booster-permanent-cutout.png',
  release_standard: '/tcg-booster-standard-cutout.png',
  release_premium: '/tcg-booster-premium-cutout.png',
  limited: '/tcg-booster-limited-cutout.png',
  weekly_protection: '/tcg-booster-limited-cutout.png',
}

function packArt(product = {}) {
  return product.wrapper_src || WRAPPERS[product.product_kind] || WRAPPERS.permanent
}

function packLines(parcel) {
  const lines = []
  for (const line of parcel?.contents || []) {
    // The room crate is a sealed-pack drop point. Furniture must never render
    // here, even if an old/stale order payload contains another line type.
    if (line.product && !line.product.product_kind && !line.product.card_count) continue
    const quantity = Math.max(1, line.quantity || 1)
    for (let index = 0; index < quantity; index += 1) {
      lines.push({
        key: `${parcel.id}-${line.product_id}-${index}`,
        name: line.product?.name || 'Booster pack',
        art: packArt(line.product || {}),
      })
    }
  }
  return lines
}

export default function RoomParcelPanel({ parcels, onCollected }) {
  const qc = useQueryClient()
  const [tearing, setTearing] = useState(false)
  const [openedPacks, setOpenedPacks] = useState(null)
  const [revealError, setRevealError] = useState('')
  const tearTimer = useRef(null)
  useEffect(() => () => window.clearTimeout(tearTimer.current), [])
  const activeParcels = parcels.filter(item => ['ready', 'collected', 'placed'].includes(item.status))
  const parcel = activeParcels[0]
  const refresh = () => Promise.all([
    qc.invalidateQueries({ queryKey: ['tcg-room-bootstrap'] }),
    qc.invalidateQueries({ queryKey: ['tcg-room-inventory'] }),
  ])
  const action = useMutation({
    mutationFn: async ({ kind, id }) => {
      if (kind === 'unpack') {
        const ready = activeParcels.filter(item => item.status === 'ready')
        await Promise.all(ready.map(item => tcgRoomApi.collectParcel(item.id)))
        return { data: { collected: true } }
      }
      return tcgRoomApi.openParcel(id)
    },
    onSuccess: async (response, variables) => {
      await refresh()
      if (variables.kind === 'unpack') {
        toast.success('Packs moved to inventory')
        onCollected?.()
        return
      }
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
        } catch (error) {
          setRevealError(error.response?.data?.detail || 'The packs opened, but the reveal could not load.')
        }
      }
    },
    onError: error => toast.error(error.response?.data?.detail || 'Could not open the booster packs'),
  })
  const beginTear = () => { setTearing(true); tearTimer.current = window.setTimeout(() => action.mutate({ kind: 'open', id: parcel.id }), 1100) }
  const cancelTear = () => { window.clearTimeout(tearTimer.current); setTearing(false) }
  if (openedPacks) return <PackOpening packs={openedPacks} onCollect={() => setOpenedPacks(null)} onSkip={() => setOpenedPacks(null)} />
  if (!parcel) return <div className="tcg-room-empty"><PackageOpen size={28} /><strong>No booster packs waiting</strong><span>Ordered packs show up here when they arrive.</span></div>
  const waiting = activeParcels.flatMap(packLines)
  return <div className="tcg-room-parcel">
    <div className="tcg-room-parcel__packs">
      {waiting.map(pack => <figure key={pack.key}><img src={pack.art} alt="" /><figcaption>{pack.name}</figcaption></figure>)}
    </div>
    {activeParcels.some(item => item.status === 'ready') && <button className="primary" disabled={action.isPending} onClick={() => action.mutate({ kind: 'unpack', id: parcel.id })}>{action.isPending ? 'Collecting…' : 'Collect packs'}</button>}
    {parcel.status !== 'ready' && <button className={`primary tcg-room-parcel__tear ${tearing ? 'tearing' : ''}`} disabled={action.isPending} onPointerDown={beginTear} onPointerUp={cancelTear} onPointerLeave={cancelTear}><PackageOpen size={19} /> {action.isPending ? 'Opening packs…' : tearing ? 'Keep holding…' : 'Hold to open'}<i /></button>}
    {revealError && <div className="tcg-room__error" role="alert">{revealError}</div>}
  </div>
}

import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { SquareStack } from 'lucide-react'
import { tcgRoomApi, tcgV2Api } from '../../lib/api'
import TCGV2CardFace from '../tcg-v2/TCGV2CardFace'

const TYPE_BY_CONTEXT = { cabinet: 'cabinet_slot', display: 'display_stand', poster: 'display_stand' }

export default function RoomDisplayManager({ context, bootstrap }) {
  const qc = useQueryClient()
  const [selectedInstance, setSelectedInstance] = useState(null)
  const desiredType = TYPE_BY_CONTEXT[context]
  const definitions = (bootstrap?.catalog || []).filter(item => item.type === desiredType)
    .filter(item => context === 'poster' ? item.asset_id === 'poster_frame' : context === 'display' ? item.asset_id !== 'poster_frame' : true)
  const definitionIds = new Set(definitions.map(item => item.id))
  const instances = (bootstrap?.owned_instances || []).filter(item => definitionIds.has(item.definition_id))
  const { data: copies = [] } = useQuery({ queryKey: ['tcg-room-copies', 'available-display'], queryFn: () => tcgRoomApi.copies({ location_kind: 'unorganized_pile' }).then(r => r.data) })
  const { data: catalog = { items: [] } } = useQuery({ queryKey: ['tcg-v2-catalog', 'room-display'], queryFn: () => tcgV2Api.catalog({ ownership: 'owned', limit: 100 }).then(r => r.data) })
  const cards = useMemo(() => new Map(catalog.items.filter(item => item.card).map(item => [item.card.id, item.card])), [catalog])
  const refresh = () => { qc.invalidateQueries({ queryKey: ['tcg-room-bootstrap'] }); qc.invalidateQueries({ queryKey: ['tcg-room-copies'] }) }
  const assign = useMutation({ mutationFn: copyId => tcgRoomApi.assignDisplay({ instance_id: selectedInstance, copy_id: copyId, slot_key: 'primary' }), onSuccess: () => { refresh(); toast.success('Physical card mounted') }, onError: error => toast.error(error.response?.data?.detail || 'Could not mount that physical copy') })
  const assignment = (bootstrap?.assignments || []).find(item => item.display_instance_id === selectedInstance)
  return <div className="tcg-room-display-manager">
    <header><SquareStack size={24} /><div><strong>{context === 'cabinet' ? 'Cabinet bays' : context === 'poster' ? 'Wall displays' : 'Display stands'}</strong><span>Each mount references one exact physical copy.</span></div></header>
    <div className="tcg-room-display-manager__items">{instances.map(instance => { const definition = definitions.find(item => item.id === instance.definition_id); const mounted = (bootstrap.assignments || []).find(item => item.display_instance_id === instance.id); return <button className={selectedInstance === instance.id ? 'selected' : ''} key={instance.id} onClick={() => setSelectedInstance(instance.id)}><strong>{definition?.name}</strong><span>{mounted ? `Copy ${mounted.physical_copy_id} mounted` : 'Empty'}</span></button> })}</div>
    {!instances.length && <div className="tcg-room-empty"><strong>No owned display fixture</strong><span>Use the desk computer or notebook Shop, then return here to assign it.</span></div>}
    {selectedInstance && <><h3>{assignment ? 'Replace mounted card' : 'Choose a card to mount'}</h3><div className="tcg-room-display-manager__cards">{copies.slice(0, 20).map(copy => { const card = cards.get(copy.card_id); return <button key={copy.id} disabled={assign.isPending} onClick={() => assign.mutate(copy.id)}>{card ? <TCGV2CardFace card={card} width="100%" showEffects /> : <span>Card {copy.card_id}</span>}<small>Physical copy {copy.id}</small></button> })}</div>{assignment && <button className="secondary" onClick={() => tcgRoomApi.assignDisplay({ instance_id: selectedInstance, copy_id: null, slot_key: 'primary' }).then(refresh)}>Return mounted card to pile</button>}</>}
  </div>
}

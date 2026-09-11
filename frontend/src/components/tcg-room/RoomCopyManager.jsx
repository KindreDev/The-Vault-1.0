import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { CheckSquare2, Library, Search } from 'lucide-react'
import { tcgRoomApi, tcgV2Api } from '../../lib/api'
import TCGV2CardFace from '../tcg-v2/TCGV2CardFace'

export default function RoomCopyManager({ context }) {
  const qc = useQueryClient()
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(new Set())
  const [binderId, setBinderId] = useState('')
  const { data: copies = [] } = useQuery({ queryKey: ['tcg-room-copies'], queryFn: () => tcgRoomApi.copies().then(r => r.data) })
  const { data: catalog = { items: [] } } = useQuery({ queryKey: ['tcg-v2-catalog', 'room-copies'], queryFn: () => tcgV2Api.catalog({ ownership: 'owned', limit: 100 }).then(r => r.data) })
  const { data: binders = [] } = useQuery({ queryKey: ['tcg-v2-binders'], queryFn: () => tcgV2Api.binders().then(r => r.data) })
  const cards = useMemo(() => new Map(catalog.items.filter(item => item.card).map(item => [item.card.id, item.card])), [catalog])
  const rows = copies.filter(copy => context === 'pile' ? ['unorganized_pile', 'carried'].includes(copy.location_kind) : true).filter(copy => {
    const card = cards.get(copy.card_id); return !query || `${card?.display_name || ''} ${card?.creator_name || ''} ${copy.card_id}`.toLowerCase().includes(query.toLowerCase())
  }).slice(0, context === 'pile' ? 24 : 60)
  const move = useMutation({
    mutationFn: ({ target, ids }) => target === 'binder'
      ? tcgRoomApi.moveToBinder(Number(binderId), ids)
      : tcgRoomApi.moveCopies(ids.map(id => ({ copy_id: id, location_kind: target }))),
    onSuccess: (_, variables) => { setSelected(new Set()); qc.invalidateQueries({ queryKey: ['tcg-room-copies'] }); qc.invalidateQueries({ queryKey: ['tcg-room-bootstrap'] }); qc.invalidateQueries({ queryKey: ['tcg-v2-binders'] }); qc.invalidateQueries({ queryKey: ['tcg-v2-binder'] }); toast.success(variables.target === 'binder' ? 'Exact physical copies filed in the authoritative binder' : 'Physical card locations updated') },
    onError: error => toast.error(error.response?.data?.detail || 'Could not move those physical copies'),
  })
  const selectedRows = rows.filter(copy => selected.has(copy.id))
  const pileIds = selectedRows.filter(copy => copy.location_kind === 'unorganized_pile').map(copy => copy.id)
  const carriedIds = selectedRows.filter(copy => copy.location_kind === 'carried').map(copy => copy.id)
  return <div className="tcg-room-copies">
    <label className="search"><Search size={18} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search physical copies" /></label>
    <div className="tcg-room-copies__summary"><span>{rows.length} visible of {copies.length} physical copies</span><span>{selected.size} selected</span></div>
    <div className="tcg-room-copies__grid">{rows.map(copy => { const card = cards.get(copy.card_id); const active = selected.has(copy.id); return <button key={copy.id} className={active ? 'selected' : ''} onClick={() => setSelected(current => { const next = new Set(current); if (next.has(copy.id)) next.delete(copy.id); else next.add(copy.id); return next })}>{card ? <TCGV2CardFace card={card} width="100%" showEffects /> : <div className="tcg-room-copy-fallback">Card {copy.card_id}</div>}<span><CheckSquare2 size={17} /> Copy #{copy.copy_ordinal} - {copy.location_kind.replaceAll('_', ' ')}</span></button> })}</div>
    {selected.size > 0 && <footer>
      {pileIds.length > 0 && <button disabled={move.isPending} onClick={() => move.mutate({ target: 'carried', ids: pileIds })}>Carry {pileIds.length} selected</button>}
      {carriedIds.length > 0 && <button disabled={move.isPending} onClick={() => move.mutate({ target: 'unorganized_pile', ids: carriedIds })}>Return {carriedIds.length} to pile</button>}
      {context === 'pile' && <><label><Library size={18} /><span>Send to binder</span><select value={binderId} onChange={event => setBinderId(event.target.value)}><option value="">Choose binder</option>{binders.map(binder => <option key={binder.id} value={binder.id}>{binder.name}</option>)}</select></label><button disabled={move.isPending || !binderId} onClick={() => move.mutate({ target: 'binder', ids: [...selected] })}>File {selected.size} selected</button></>}
    </footer>}
  </div>
}

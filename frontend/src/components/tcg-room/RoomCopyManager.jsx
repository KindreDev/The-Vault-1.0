import { LocalizedText, useT } from '../../i18n'
import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { CheckSquare2, Library, Search } from 'lucide-react'
import { tcgRoomApi, tcgV2Api } from '../../lib/api'
import TCGV2CardFace from '../tcg-v2/TCGV2CardFace'

export default function RoomCopyManager({ context }) {
  const t = useT()
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
    onSuccess: (_, variables) => { setSelected(new Set()); qc.invalidateQueries({ queryKey: ['tcg-room-copies'] }); qc.invalidateQueries({ queryKey: ['tcg-room-bootstrap'] }); qc.invalidateQueries({ queryKey: ['tcg-v2-binders'] }); qc.invalidateQueries({ queryKey: ['tcg-v2-binder'] }); toast.success(variables.target === t("binder") ? t("Exact physical copies filed in the authoritative binder") : t("Physical card locations updated")) },
    onError: error => toast.error(error.response?.data?.detail || t("Could not move those physical copies")),
  })
  const selectedRows = rows.filter(copy => selected.has(copy.id))
  const pileIds = selectedRows.filter(copy => copy.location_kind === 'unorganized_pile').map(copy => copy.id)
  const carriedIds = selectedRows.filter(copy => copy.location_kind === 'carried').map(copy => copy.id)
  return <div className="tcg-room-copies">
    <label className="search"><Search size={18} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder={t("Search physical copies")} /></label>
    <div className="tcg-room-copies__summary"><span>{rows.length}<LocalizedText text={"visible of"} before={" "} after={" "} />{copies.length}<LocalizedText text={"physical copies"} before={" "} /></span><span>{selected.size}<LocalizedText text={"selected"} before={" "} /></span></div>
    <div className="tcg-room-copies__grid">{rows.map(copy => { const card = cards.get(copy.card_id); const active = selected.has(copy.id); return <button key={copy.id} className={active ? 'selected' : ''} onClick={() => setSelected(current => { const next = new Set(current); if (next.has(copy.id)) next.delete(copy.id); else next.add(copy.id); return next })}>{card ? <TCGV2CardFace card={card} width="100%" showEffects /> : <div className="tcg-room-copy-fallback"><LocalizedText text={"Card"} after={" "} />{copy.card_id}</div>}<span><CheckSquare2 size={17} /><LocalizedText text={"Copy #"} before={" "} />{copy.copy_ordinal} - {copy.location_kind.replaceAll('_', ' ')}</span></button> })}</div>
    {selected.size > 0 && <footer>
      {pileIds.length > 0 && <button disabled={move.isPending} onClick={() => move.mutate({ target: 'carried', ids: pileIds })}><LocalizedText text={"Carry"} after={" "} />{pileIds.length}<LocalizedText text={"selected"} before={" "} /></button>}
      {carriedIds.length > 0 && <button disabled={move.isPending} onClick={() => move.mutate({ target: 'unorganized_pile', ids: carriedIds })}><LocalizedText text={"Return"} after={" "} />{carriedIds.length}<LocalizedText text={"to pile"} before={" "} /></button>}
      {context === 'pile' && <><label><Library size={18} /><span><LocalizedText text={"Send to binder"} /></span><select value={binderId} onChange={event => setBinderId(event.target.value)}><option value=""><LocalizedText text={"Choose binder"} /></option>{binders.map(binder => <option key={binder.id} value={binder.id}>{binder.name}</option>)}</select></label><button disabled={move.isPending || !binderId} onClick={() => move.mutate({ target: 'binder', ids: [...selected] })}><LocalizedText text={"File"} after={" "} />{selected.size}<LocalizedText text={"selected"} before={" "} /></button></>}
    </footer>}
  </div>
}

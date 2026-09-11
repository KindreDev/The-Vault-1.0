import { useQuery } from '@tanstack/react-query'
import { cardsApi } from '../../lib/api'
import TCGV2CardFace from '../tcg-v2/TCGV2CardFace'
import { cardLabel } from './traderVNState'

export default function TraderCardPreview({ cardId, compact = false }) {
  const { data, isLoading } = useQuery({
    queryKey: ['trader-card', cardId],
    queryFn: () => cardsApi.get(cardId).then(response => response.data),
    enabled: Boolean(cardId),
    staleTime: 60_000,
  })
  return <div className={`trader-vn-card ${compact ? 'compact' : ''}`}>
    <div className="trader-vn-card__face">
      {data ? <TCGV2CardFace card={data} width={compact ? 94 : 132} showEffects={false} /> : <span>{isLoading ? 'Loading card…' : `Card #${cardId}`}</span>}
    </div>
    <strong>{cardLabel(cardId, data)}</strong>
    {data && <span>{data.card_type} · {data.print_rarity || data.rarity_class || 'C'}</span>}
  </div>
}

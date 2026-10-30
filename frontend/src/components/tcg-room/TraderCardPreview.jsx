import { useQuery } from '@tanstack/react-query'
import { LocalizedText } from '../../i18n'
import TCGV2CardFace from '../tcg-v2/TCGV2CardFace'
import { cardLabel } from './traderVNState'
import { loadTraderCard } from './traderCardLoader'

export default function TraderCardPreview({ cardId, compact = false, showMeta = true, width: faceWidth }) {
  const { data, isLoading } = useQuery({
    queryKey: ['trader-card', cardId],
    queryFn: () => loadTraderCard(cardId),
    enabled: Boolean(cardId),
    staleTime: 60_000,
  })
  const width = faceWidth || (compact ? 94 : 132)
  return <div className={`trader-vn-card ${compact ? 'compact' : ''}`}>
    <div className="trader-vn-card__face" style={{ '--trader-card-width': `${width}px` }}>
      {data
        ? <TCGV2CardFace card={data} width={width} showEffects={false} fallback={<span className="trader-vn-card__missing"><LocalizedText text="Card art unavailable" /></span>} />
        : <span className="trader-vn-card__missing">{isLoading ? <LocalizedText text="Loading card…" /> : <>{`#${cardId}`}</>}</span>}
    </div>
    {showMeta && <strong>{cardLabel(cardId, data)}</strong>}
    {showMeta && data && <span>{data.card_type} · {data.print_rarity || data.rarity_class || 'C'}</span>}
  </div>
}

import { useQuery } from '@tanstack/react-query'
import { useT } from '../../../i18n'
import { tcgRoomApi } from '../../../lib/api'
import { COPY_LOCATIONS, Section, formatDate } from './inspectorMeta'

// Everything about owning the card: each physical copy, where it is printed,
// how you got it and the milestones it crossed.

const SOURCE_LABELS = {
  pack: 'Pulled from a pack', booster: 'Pulled from a booster', trader: 'Bought from a trader',
  trader_request: 'Requested from a trader', creator_completion: 'Creator completion reward',
  daily_completion: 'Daily completion reward', weekly_completion: 'Weekly completion reward',
  duplicate_dismantle: 'Dismantled a duplicate', legacy_import: 'Carried over from the old collection',
  legacy_inventory: 'Carried over from the old collection', legacy_workshop: 'Old workshop',
}

export default function CollectionTab({ detail }) {
  const t = useT()
  const { data: copies = [] } = useQuery({
    queryKey: ['tcg-room-copies', 'card', detail.card.id],
    queryFn: () => tcgRoomApi.copies({ card_id: detail.card.id }).then(r => r.data),
  })
  const owned = copies.filter(copy => copy.location_kind !== 'traded_away')
  return <div className="tcgcw-stack">
    <Section title={t('Copies')} aside={<span className="tcgcw-count">{detail.quantity_owned}</span>}>
      {owned.length === 0
        ? <p className="tcgcw-quiet">{t(detail.quantity_owned ? 'Copies are still being placed in the room.' : "You don't own this card yet.")}</p>
        : <div className="tcgcw-rows">{owned.map(copy => <div key={copy.id}>
          <strong>{t('Copy #{number}', { number: copy.copy_ordinal })}</strong>
          <span>{t(COPY_LOCATIONS[copy.location_kind] || copy.location_kind)}</span>
          <b className={copy.grade ? 'is-graded' : ''}>{copy.grade ? t('Grade {grade}', { grade: copy.grade }) : t('Ungraded')}</b>
        </div>)}</div>}
    </Section>
    {detail.relationships.length > 0 && <Section title={t('Printed in')}>
      <div className="tcgcw-rows">{detail.relationships.map((item, index) => <div key={index}>
        <strong>{item.set_name || t('Release card')}</strong>
        <span>{item.release_name}</span>
        <b>#{String(item.collector_position).padStart(3, '0')}{item.collector_suffix}</b>
      </div>)}</div>
    </Section>}
    {detail.acquisitions.length > 0 && <Section title={t('How you got it')}>
      <ol className="tcgcw-timeline">{detail.acquisitions.map(item => <li key={item.id}>
        <strong>{t(SOURCE_LABELS[item.source_type] || item.source_type.replaceAll('_', ' '))}</strong>
        <span>{formatDate(item.acquired_at) || t('Date unknown')} · {Math.abs(item.quantity)} {t(Math.abs(item.quantity) === 1 ? 'copy' : 'copies')}{item.quantity < 0 ? ` ${t('removed')}` : ''}</span>
      </li>)}</ol>
    </Section>}
    {detail.bond_milestones.length > 0 && <Section title={t('Bond milestones')}>
      <ol className="tcgcw-timeline">{detail.bond_milestones.map(item => <li key={item.threshold}>
        <strong>{t('{count} engagements', { count: item.threshold })}</strong>
        <span>{formatDate(item.crossed_at) || t('Date unknown')}</span>
      </li>)}</ol>
    </Section>}
  </div>
}

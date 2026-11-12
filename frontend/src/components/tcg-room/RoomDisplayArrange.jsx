import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { ArrowDownWideNarrow, Wand2 } from 'lucide-react'
import { useT } from '../../i18n'
import { apiErrorMessage, tcgRoomApi, tcgV2Api } from '../../lib/api'

// A stand that arranges itself: fill its empty slots from the pile with a
// Spice level, a trait you love, or your best cards, then order it.

const SPICE_FILLS = [['safe', 'Safe'], ['suggestive', 'Suggestive'], ['explicit', 'Explicit'], ['hardcore', 'Hardcore']]

export default function RoomDisplayArrange({ instanceId, onDone }) {
  const t = useT()
  const [busy, setBusy] = useState(false)
  const [fill, setFill] = useState({ fill: 'best', value: null, label: 'Best cards' })
  const { data } = useQuery({ queryKey: ['tcg-v2-collections'], queryFn: () => tcgV2Api.collections().then(r => r.data), staleTime: 300000 })
  const traits = (data?.traits || []).slice(0, 10)
  const run = async (request, success) => {
    setBusy(true)
    try {
      const { data: result } = await tcgRoomApi.arrangeDisplay(instanceId, request)
      toast.success(success(result))
      await onDone?.()
    } catch (error) {
      toast.error(apiErrorMessage(error, t('Could not arrange this stand')))
    } finally {
      setBusy(false)
    }
  }
  const choices = [
    { fill: 'best', value: null, label: 'Best cards' },
    ...SPICE_FILLS.map(([value, label]) => ({ fill: 'spice', value, label })),
    ...traits.map(trait => ({ fill: 'trait', value: trait.id, label: trait.name })),
  ]
  return <div className="tcg-room-arrange">
    <span>{t('Fill empty slots with')}</span>
    <div className="tcg-room-arrange__chips">{choices.map(choice => (
      <button key={`${choice.fill}-${choice.value}`} type="button"
              className={fill.fill === choice.fill && fill.value === choice.value ? 'selected' : ''}
              onClick={() => setFill(choice)}>{t(choice.label)}</button>
    ))}</div>
    <div className="tcg-room-arrange__actions">
      <button type="button" disabled={busy} onClick={() => run({ fill: fill.fill, value: fill.value, sort: 'spice' },
        result => result.added ? t('Added {count} cards', { count: result.added }) : t('No matching cards in your pile'))}>
        <Wand2 size={16} />{t('Fill')}
      </button>
      <button type="button" disabled={busy} onClick={() => run({ sort: 'spice' }, () => t('Ordered Safe to Hardcore'))}>
        <ArrowDownWideNarrow size={16} />{t('Safe → Hardcore')}
      </button>
      <button type="button" disabled={busy} onClick={() => run({ sort: 'rarity' }, () => t('Ordered rarest first'))}>
        <ArrowDownWideNarrow size={16} />{t('Rarest first')}
      </button>
    </div>
  </div>
}

import { useT } from '../../i18n'
import TCGSelect from './TCGSelect'
import './target-card-type-picker.css'

const OPTIONS = [
  ['', 'Any card type'], ['image', 'Scene'], ['gallery', 'Gallery'],
  ['creator', 'Creator'], ['bond', 'Bond'], ['variant', 'Cosplay'], ['collab', 'Collab'],
]

// One compact dropdown, so a targetable pack is the same height as the others.
export default function TargetCardTypePicker({ value = '', onChange, id = 'pack-target-type' }) {
  const t = useT()
  return <div className="tcg-target-picker" aria-describedby={value ? `${id}-help` : undefined}>
    <TCGSelect label={t('Target card type')} value={value} onChange={onChange}
               options={OPTIONS.map(([type, label]) => ({ value: type, label: t(label) }))} />
    {value && <p id={`${id}-help`}>{value === 'image' || value === 'gallery'
      ? t('At least half the pack will match.')
      : t('At least one card will match.')}</p>}
  </div>
}

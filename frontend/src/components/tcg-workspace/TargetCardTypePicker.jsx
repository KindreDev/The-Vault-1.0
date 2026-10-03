import { useT } from '../../i18n'
import './target-card-type-picker.css'

const OPTIONS = [
  ['', 'Any card type'], ['image', 'Photo'], ['gallery', 'Gallery'],
  ['creator', 'Creator'], ['bond', 'Bond'], ['variant', 'Cosplay'], ['collab', 'Collab'],
]

export default function TargetCardTypePicker({ value = '', onChange, id = 'pack-target-type' }) {
  const t = useT()
  return <fieldset className="tcg-target-picker" aria-describedby={`${id}-help`}>
    <legend>{t('Target card type')}</legend>
    <div>{OPTIONS.map(([type, label]) => <button key={type || 'any'} type="button" aria-pressed={value === type} onClick={() => onChange(type)}>{t(label)}</button>)}</div>
    <p id={`${id}-help`}>{value === 'image' || value === 'gallery'
      ? t('At least half the pack will match your target.')
      : value ? t('At least one card will match your target. Hall of Fame cards may still appear randomly.')
        : t('Choose a type to guarantee matching cards. Hall of Fame cards may appear randomly.')}</p>
  </fieldset>
}

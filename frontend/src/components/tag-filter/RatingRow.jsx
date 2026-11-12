import { Ban, Check } from 'lucide-react'
import { useT } from '../../i18n'
import { RATINGS } from './tagFilterMeta'

// One chip per Spice level. Click cycles: off → only this → hide this → off.
export default function RatingRow({ tagsByName, stateOf, onCycle }) {
  const t = useT()
  const available = RATINGS.filter(r => tagsByName.get(r.name))
  if (!available.length) return null
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-[16px] font-semibold text-white/60 mr-1">{t('Spice')}</span>
      {available.map(r => {
        const tag = tagsByName.get(r.name)
        const state = stateOf(tag)
        const on = state === 'include'
        const off = state === 'exclude'
        return (
          <button key={r.name} type="button" onMouseDown={e => { e.preventDefault(); onCycle(tag) }}
                  title={on ? t('Showing only {name}. Click to hide it instead.', { name: t(r.label) })
                    : off ? t('Hiding {name}. Click to clear.', { name: t(r.label) })
                    : t('Click to show only {name}, again to hide it.', { name: t(r.label) })}
                  className="flex items-center gap-1.5 px-3 py-1 rounded-full text-[16px] cursor-pointer transition-colors"
                  style={{
                    background: on ? `color-mix(in srgb, ${r.color} 26%, transparent)` : 'rgba(255,255,255,0.04)',
                    color: on ? `color-mix(in srgb, ${r.color} 55%, white)` : off ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.7)',
                    border: `0.5px solid ${on ? `color-mix(in srgb, ${r.color} 60%, transparent)` : off ? 'color-mix(in srgb, var(--c-pink) 45%, transparent)' : 'rgba(255,255,255,0.1)'}`,
                    textDecoration: off ? 'line-through' : 'none',
                  }}>
            {on ? <Check size={14} /> : off ? <Ban size={14} style={{ color: 'var(--c-pink)' }} />
              : <span className="w-2 h-2 rounded-full" style={{ background: r.color }} />}
            {t(r.label)}
          </button>
        )
      })}
    </div>
  )
}

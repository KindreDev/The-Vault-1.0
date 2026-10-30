import { useT } from '../../i18n'
import { Archive, BookOpen, Cuboid, Layers3, Settings2, Sparkles, ShoppingCart } from 'lucide-react'

export const TCG_VIEWS = [
  { id: 'releases', label: 'Releases', icon: Sparkles },
  { id: 'sets', label: 'Sets', icon: Layers3 },
  { id: 'cards', label: 'All Cards', icon: Archive },
  { id: 'binders', label: 'Binders', icon: BookOpen },
  { id: 'workshop', label: 'Shop', icon: ShoppingCart },
  { id: 'room', label: 'Collection Room', icon: Cuboid },
]

// Collection scopes (Missing, Duplicates…) live under All Cards.
const CARD_SCOPES = new Set(['cards', 'missing', 'duplicates', 'creators', 'characters', 'hof', 'bond'])

const ACTIVE_STYLE = {
  background: 'color-mix(in srgb, var(--c-accent) 18%, transparent)',
  color: 'var(--c-accent-text)',
  border: '0.5px solid color-mix(in srgb, var(--c-accent) 40%, transparent)',
}
const IDLE_STYLE = { background: 'transparent', color: 'rgba(255,255,255,0.45)', border: '0.5px solid transparent' }

// Same tab strip as the Vault's hub pages (components/layout/HubPage.jsx), so
// theme packs restyle the card collection together with the rest of the app.
export default function TCGNavigation({ view, onView, advanced, onAdvanced }) {
  const t = useT()
  const activeId = CARD_SCOPES.has(view) ? 'cards' : view
  return (
    <div className="vault-theme-settings-tabs tcgws-tabs flex items-center gap-1 overflow-x-auto flex-shrink-0 px-5 pt-4 pb-3"
         role="tablist" aria-label={t('Card collection views')}
         style={{ scrollbarWidth: 'none', borderBottom: '0.5px solid rgba(255,255,255,0.07)', background: 'var(--c-surface)' }}>
      {TCG_VIEWS.map(({ id, label, icon: Icon }) => {
        const active = id === activeId
        return (
          <button key={id} type="button" role="tab" aria-selected={active} data-active={active}
                  onClick={() => onView(id)}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg text-[17px] font-medium whitespace-nowrap transition-all flex-shrink-0 cursor-pointer"
                  style={active ? ACTIVE_STYLE : IDLE_STYLE}>
            <Icon size={14} />
            {t(label)}
          </button>
        )
      })}
      <button type="button" onClick={onAdvanced}
              className="tcgws-advanced-pill ml-auto flex items-center gap-2 px-4 py-2 rounded-lg text-[16px] whitespace-nowrap flex-shrink-0 cursor-pointer"
              title={t('Advanced collection settings')} aria-label={t('Advanced collection settings')}
              style={advanced ? ACTIVE_STYLE : IDLE_STYLE}>
        <Settings2 size={14} />
        {t('Advanced')}
        <span style={{ opacity: 0.7 }}>{advanced ? t('On') : t('Off')}</span>
      </button>
    </div>
  )
}

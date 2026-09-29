import { LocalizedText, useT } from '../../i18n'
import { Archive, BookOpen, Cuboid, Layers3, PackageOpen, Settings2, Sparkles, Wrench } from 'lucide-react'

export const TCG_VIEWS = [
  { id: 'releases', label: 'Releases', icon: Sparkles },
  { id: 'sets', label: 'Sets', icon: Layers3 },
  { id: 'cards', label: 'All Cards', icon: Archive },
  { id: 'packs', label: 'Boosters', icon: PackageOpen },
  { id: 'binders', label: 'Binders', icon: BookOpen },
  { id: 'workshop', label: 'Shop', icon: Wrench },
  { id: 'room', label: 'Collection Room', icon: Cuboid },
]

export default function TCGNavigation({ view, onView, advanced, onAdvanced }) {
  const t = useT()
  return (
    <div className="tcgws-nav">
      <nav aria-label={t("Card collection views")}>
        {TCG_VIEWS.map(item => {
          const Icon = item.icon
          return (
            <button key={item.id} className={view === item.id ? 'active' : ''} onClick={() => onView(item.id)} title={t(item.label)} aria-label={t(item.label)}>
              <Icon size={18} /><span>{t(item.label)}</span>
            </button>
          )
        })}
      </nav>
      <button className={`tcgws-advanced ${advanced ? 'active' : ''}`} onClick={onAdvanced} title={t("Advanced collection settings")} aria-label={t("Advanced collection settings")}>
        <Settings2 size={18} /><span><LocalizedText text={"Advanced"} /></span><i>{advanced ? t('On') : t('Off')}</i>
      </button>
    </div>
  )
}

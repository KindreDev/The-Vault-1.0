import { CalendarHeart, Droplet, Eye, Flame, Repeat, Sparkles, Trophy } from 'lucide-react'
import { useT } from '../../../i18n'
import { formatHofAwardDescription } from '../hofProvenance'
import { RARITY_NAMES, formatDate } from './inspectorMeta'

// The back of the card: its story with you, from the activity log, plus the
// traits printed on the front and where your copy came from.

const TRAIT_KIND_LABELS = { favorite: 'Starred', type: 'Your type', rare: 'Rare', plain: '' }

export default function CardBack({ detail, name }) {
  const t = useT()
  const story = detail?.story || {}
  const card = detail?.card || {}
  const rarity = card.print_rarity || card.rarity_class
  const traits = card.traits || []
  const award = formatHofAwardDescription(detail?.hof?.provenance, t)
  const firstCopy = [...(detail?.acquisitions || [])].filter(item => item.quantity > 0).pop()
  const moments = [
    story.landed && { icon: CalendarHeart, label: t('Landed in your vault'), value: formatDate(story.landed) },
    story.first_seen && { icon: Eye, label: t('First seen'), value: formatDate(story.first_seen) },
    story.last_seen && story.last_seen !== story.first_seen && { icon: Eye, label: t('Last seen'), value: formatDate(story.last_seen) },
    story.days_visited > 1 && { icon: Repeat, label: t('Came back on'), value: t('{count} days', { count: story.days_visited }) },
    story.first_finish && { icon: Droplet, label: t('First finish'), value: formatDate(story.first_finish) },
    story.finishes > 1 && { icon: Droplet, label: t('Finishes logged'), value: story.finishes },
    story.best_day && { icon: Flame, label: t('Biggest day'), value: formatDate(story.best_day) },
  ].filter(Boolean)
  return <div className="tcgcw-back" data-rarity={rarity}>
    <header>
      <span>THE VAULT</span>
      <b>{t(RARITY_NAMES[rarity] || rarity || '')}</b>
    </header>
    <h3>{name}</h3>
    {award && <p className="tcgcw-back__award"><Trophy size={15} />{award}</p>}
    <section>
      <h4>{t('Your story')}</h4>
      {moments.length
        ? <dl>{moments.map(item => <div key={item.label}><dt><item.icon size={15} />{item.label}</dt><dd>{item.value}</dd></div>)}</dl>
        : <p className="tcgcw-back__quiet">{t('No moments yet. They fill in as you watch.')}</p>}
    </section>
    {traits.length > 0 && <section>
      <h4>{t('Traits')}</h4>
      <div className="tcgcw-back__traits">{traits.map(trait => <span key={trait.id} data-kind={trait.kind}>
        {trait.name}{TRAIT_KIND_LABELS[trait.kind] && <small>{t(TRAIT_KIND_LABELS[trait.kind])}</small>}
      </span>)}</div>
    </section>}
    <footer>
      {firstCopy && <span><Sparkles size={14} />{t('Your copy: {date}', { date: formatDate(firstCopy.acquired_at) || t('date unknown') })}</span>}
      <span>{card.card_code}</span>
      <small>{t('Moments are counted since activity tracking began.')}</small>
    </footer>
  </div>
}

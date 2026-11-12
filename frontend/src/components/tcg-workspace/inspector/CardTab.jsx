import { useT } from '../../../i18n'
import { Crown, Gem, Heart, Sparkles } from 'lucide-react'
import { formatHofAwardDescription } from '../hofProvenance'
import { RARITY_NAMES, SPICE_META, PEOPLE_LABELS, Section, ProgressBar, formatDate } from './inspectorMeta'

// The first thing you see: what the card is, your history with it, why you'd
// like it and where it sits in your collection.

function Glance({ detail }) {
  const t = useT()
  const profile = detail.profile || {}
  const spice = SPICE_META[profile.spice] || (detail.classification.intensity !== 'Unknown' ? { label: detail.classification.intensity } : null)
  const exposure = detail.classification.exposure
  const tiles = [
    spice && { label: t('Spice'), value: t(spice.label), color: spice.color },
    exposure && exposure !== 'Unknown' && { label: t('Exposure'), value: t(exposure) },
    profile.people && { label: t('People'), value: t(PEOPLE_LABELS[profile.people] || profile.people) },
    { label: t('Medium'), value: t(detail.medium === 'video' ? 'Video' : detail.medium === 'unknown' ? 'Card art' : 'Photo') },
  ].filter(Boolean)
  return <div className="tcgcw-glance">
    {tiles.map(tile => <div key={tile.label} style={tile.color ? { '--tcgcw-tone': tile.color } : undefined} className={tile.color ? 'is-toned' : ''}>
      <span>{tile.label}</span><strong>{tile.value}</strong>
    </div>)}
  </div>
}

function History({ stats, title }) {
  const t = useT()
  const minutes = Math.round(Number(stats.view_seconds || 0) / 60)
  const items = [
    { label: t('Views'), value: stats.views },
    { label: t('Minutes'), value: minutes },
    { label: t('Cums'), value: stats.cum_count },
    { label: t('Edges'), value: stats.edge_count },
  ].filter(item => Number(item.value) > 0)
  const rating = stats.rating ? `${stats.rating}/10` : null
  if (!items.length && !rating) return <p className="tcgcw-quiet">{t("{name}: nothing logged yet.", { name: title })}</p>
  return <div>
    <div className="tcgcw-subhead">{title}</div>
    <div className="tcgcw-stats">
      {items.map(item => <div key={item.label}><strong>{Number(item.value).toLocaleString()}</strong><span>{item.label}</span></div>)}
      {rating && <div><strong>{rating}</strong><span>{t('Your rating')}</span></div>}
    </div>
  </div>
}

function subjectTitle(stats, t) {
  return { 'This photo': t('This photo'), 'This video': t('This video'), 'This gallery': t('This gallery') }[stats.subject_label] || stats.subject_label
}

function TraitChip({ trait, badge }) {
  return <span className="tcgcw-chip">{trait.name}{badge && <small>{badge}</small>}</span>
}

function WhyYou({ profile }) {
  const t = useT()
  const matches = profile?.taste_matches || []
  const rare = profile?.rare_traits || []
  if (!matches.length && !rare.length) return null
  return <Section title={t('Why it stands out')}>
    {matches.length > 0 && <div className="tcgcw-callout"><Heart size={16} />
      <div><strong>{t('Your type')}</strong>
        <p>{t('You engage with these more than the rest of your library.')}</p>
        <div className="tcgcw-chips">{matches.map(trait => <TraitChip key={trait.id} trait={trait} badge={`×${trait.lift.toFixed(1)}`} />)}</div></div>
    </div>}
    {rare.length > 0 && <div className="tcgcw-callout"><Gem size={16} />
      <div><strong>{t('Rare in your library')}</strong>
        <p>{t('Few of your files have these.')}</p>
        <div className="tcgcw-chips">{rare.map(trait => <TraitChip key={trait.id} trait={trait} badge={`${(trait.share * 100).toFixed(trait.share < 0.01 ? 1 : 0)}%`} />)}</div></div>
    </div>}
  </Section>
}

function Progress({ detail }) {
  const t = useT()
  const card = detail.card
  const sets = detail.progress?.sets || []
  const person = detail.progress?.person
  const personName = card.creator_name || card.display_name
  const hasLevel = card.level_max > 1
  if (!sets.length && !person && !hasLevel) return null
  return <Section title={t('Collection')}>
    <div className="tcgcw-progress-list">
      {sets.map(item => <ProgressBar key={item.set_id} label={item.name || t('Set')} note={item.release_name} value={item.owned} max={item.total} />)}
      {person && <ProgressBar label={t("{name}'s cards", { name: personName })} value={person.owned} max={person.total} />}
      {hasLevel && (card.level >= card.level_max
        ? <ProgressBar label={t('Card level {level}', { level: card.level })} value={1} max={1} count={t('Max level')} />
        : <ProgressBar label={t('Card level {level}', { level: card.level })} note={t('{xp} XP to level {next}', { xp: Math.max(0, (card.cxp_for_next || 0) - (card.cxp || 0)), next: card.level + 1 })}
                       value={card.cxp || 0} max={card.cxp_for_next || 1} count={`${card.cxp || 0} / ${card.cxp_for_next || 0} XP`} />)}
    </div>
  </Section>
}

function WhyRarity({ detail }) {
  const t = useT()
  const audit = detail.mint_audit || {}
  const personal = audit.personal_value
  const published = audit.published_rarity
  const name = t(RARITY_NAMES[published] || published || 'Unknown')
  const lead = personal?.base_rarity && personal.base_rarity !== published
    ? t('It rolled {base}; how much you enjoyed the source raised it to {rarity}.', { base: t(RARITY_NAMES[personal.base_rarity] || personal.base_rarity), rarity: name })
    : personal?.rarity_floor
      ? t('Your engagement guaranteed at least {floor}.', { floor: t(RARITY_NAMES[personal.rarity_floor] || personal.rarity_floor) })
      : t('{rarity} is its random roll; engagement did not change it.', { rarity: name })
  return <Section title={t('Why {rarity}', { rarity: name })}>
    <p className="tcgcw-lead">{lead}</p>
    {personal?.factors?.length > 0 && <div className="tcgcw-chips">
      {personal.factors.map(factor => <span key={factor.key} className="tcgcw-chip" title={factor.detail}>{factor.label}<small>+{factor.points}</small></span>)}
    </div>}
  </Section>
}

export default function CardTab({ detail }) {
  const t = useT()
  const hofAward = formatHofAwardDescription(detail.hof?.provenance, t)
  const engagement = detail.engagement || {}
  return <div className="tcgcw-stack">
    {hofAward && <div className="tcgcw-award"><Crown size={20} />
      <div><strong>{hofAward}</strong>
        {detail.hof.provenance.gallery_name && detail.hof.provenance.recipient_type !== 'gallery' && <span>{t('Winning gallery: {name}', { name: detail.hof.provenance.gallery_name })}</span>}
        {detail.hof.score != null && detail.hof.field_size != null && <span>{t('Score {score} · field of {field}', { score: detail.hof.score, field: detail.hof.field_size })}</span>}</div>
    </div>}
    <Glance detail={detail} />
    <Section title={t('Your history')}>
      <History stats={engagement} title={subjectTitle(engagement, t)} />
      {engagement.secondary && <History stats={engagement.secondary} title={engagement.secondary.subject_label} />}
    </Section>
    <WhyYou profile={detail.profile} />
    <Progress detail={detail} />
    <WhyRarity detail={detail} />
    <Section title={t('Details')}>
      <dl className="tcgcw-facts">
        <div><dt>{t('Copies owned')}</dt><dd>{detail.quantity_owned}</dd></div>
        <div><dt>{t('First acquired')}</dt><dd>{formatDate(detail.dates.acquired) || t('Not owned yet')}</dd></div>
        <div><dt>{t('Photo date')}</dt><dd>{formatDate(detail.dates.published) || t('Unknown')}</dd></div>
        <div><dt>{t('Card printed')}</dt><dd>{formatDate(detail.dates.card_published) || t('Unknown')}</dd></div>
        {detail.card.prestige && <div><dt>{t('Finish')}</dt><dd><Sparkles size={15} /> {t('Prestige')}</dd></div>}
        {detail.card.foil && !detail.card.prestige && <div><dt>{t('Finish')}</dt><dd><Sparkles size={15} /> {t('Foil')}</dd></div>}
      </dl>
    </Section>
  </div>
}

import { RATINGS } from '../../tag-filter/tagFilterMeta'

// Shared names and small pieces for the card window.

export const RARITY_NAMES = { C: 'Common', R: 'Rare', SR: 'Super Rare', UR: 'Ultra Rare', SPR: 'Signature Rare' }
export const CARD_TYPE_LABELS = {
  image: 'Scene', scene: 'Scene', gallery: 'Gallery', creator: 'Creator', character: 'Character',
  cosplay: 'Cosplay', variant: 'Cosplay', collab: 'Collab', bond: 'Bond', hof: 'Hall of Fame',
}
export const SPICE_META = Object.fromEntries(RATINGS.map(r => [r.name, r]))
export const PEOPLE_LABELS = { solo: 'Solo', duo: 'Duo', group: 'Group' }
export const COPY_LOCATIONS = {
  unorganized_pile: 'In the room pile', carried: 'Carried in the room', binder_slot: 'In a binder',
  cabinet_slot: 'In a display cabinet', display_stand: 'On a display stand', traded_away: 'Traded away',
}

export const cardTypeLabel = value => CARD_TYPE_LABELS[value] || value || 'Card'

export function formatDate(value) {
  if (!value) return null
  // A bare YYYY-MM-DD is a calendar day, not UTC midnight (which shows the day before west of UTC).
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  const date = day ? new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3])) : new Date(value)
  return Number.isNaN(date.getTime()) ? value.slice(0, 10)
    : date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

export function Section({ title, children, aside }) {
  return <section className="tcgcw-section">
    <header><h4>{title}</h4>{aside}</header>
    {children}
  </section>
}

export function ProgressBar({ label, note, value, max, count }) {
  const percent = max ? Math.min(100, Math.round((value / max) * 100)) : 0
  return <div className="tcgcw-progress">
    <div><strong>{label}</strong>{note && <span>{note}</span>}<b>{count ?? `${value.toLocaleString()} / ${max.toLocaleString()}`}</b></div>
    <i><em style={{ width: `${percent}%` }} /></i>
  </div>
}

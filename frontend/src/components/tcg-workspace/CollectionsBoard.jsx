import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Check, Heart, Star, Trophy } from 'lucide-react'
import { useT } from '../../i18n'
import { tcgV2Api } from '../../lib/api'
import { SPICE_META } from './inspector/inspectorMeta'
import './collections-board.css'

// Goals across the whole catalogue: trait collections (own 5 / 15 / 40 / 100
// cards with a trait you love) and Spice ladders (one of her cards at every
// Spice level). Rewards are paid when the board is opened.

function TraitCollection({ trait }) {
  const t = useT()
  const next = trait.tiers.find(tier => !tier.reached)
  const goal = next?.target || trait.tiers[trait.tiers.length - 1]?.target || 1
  const percent = Math.min(100, Math.round((trait.owned / goal) * 100))
  return <article className="tcgcb-trait" data-kind={trait.kind}>
    <header>
      <span className="tcgcb-kind">{trait.kind === 'favorite' ? <><Star size={14} />{t('Starred')}</> : <><Heart size={14} />{t('Your type')}</>}</span>
      <h3>{trait.name}</h3>
      <p>{t('{owned} owned · {available} in the catalogue', { owned: trait.owned.toLocaleString(), available: trait.available.toLocaleString() })}</p>
    </header>
    <div className="tcgcb-bar"><i style={{ width: `${percent}%` }} /></div>
    <div className="tcgcb-tiers">
      {trait.tiers.map(tier => <span key={tier.target} className={tier.reached ? 'is-reached' : ''} title={t('{xp} XP and {credits} Credits', { xp: tier.xp, credits: tier.credits })}>
        {tier.reached && <Check size={13} />}{tier.target}
      </span>)}
    </div>
    <footer>{next ? t('Next: {count} more for {credits} Credits', { count: next.target - trait.owned, credits: next.credits }) : t('Complete!')}</footer>
  </article>
}

function SpiceLadder({ ladder }) {
  const t = useT()
  return <article className={`tcgcb-ladder${ladder.complete ? ' is-complete' : ''}`}>
    <div className="tcgcb-ladder__who">
      {ladder.avatar ? <img src={ladder.avatar} alt="" /> : <span>{ladder.name.slice(0, 1)}</span>}
      <div><strong>{ladder.name}</strong><small>{ladder.complete ? t('Ladder complete') : t('{done} of {needed} steps', { done: ladder.done, needed: ladder.needed })}</small></div>
    </div>
    <ol className="tcgcb-rungs">
      {ladder.steps.map(step => {
        const meta = SPICE_META[step.level]
        const state = !step.available ? 'none' : step.owned ? 'owned' : 'missing'
        const title = state === 'none'
          ? t('She has no {level} cards yet', { level: t(meta?.label) })
          : t('{owned} of {available} owned', { owned: step.owned, available: step.available })
        return <li key={step.level} data-state={state} style={{ '--tcgcb-tone': meta?.color }} title={title}>
          {state === 'owned' && <Check size={14} />}{t(meta?.label || step.level)}
        </li>
      })}
    </ol>
    {!ladder.complete && <small className="tcgcb-reward">{t('{credits} Credits when complete', { credits: ladder.credits })}</small>}
  </article>
}

export default function CollectionsBoard() {
  const t = useT()
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({ queryKey: ['tcg-v2-collections'], queryFn: () => tcgV2Api.collections().then(r => r.data) })
  useEffect(() => {
    if (!data?.new_awards?.length) return
    data.new_awards.forEach(award => toast.success(t('{label} reached: +{credits} Credits', { label: award.label, credits: award.credits }), { icon: '🏆' }))
    qc.invalidateQueries({ queryKey: ['profile'] })
  }, [data, qc, t])
  if (isLoading) return <p className="tcgcb-quiet">{t('Counting your collection...')}</p>
  const traits = data?.traits || []
  const ladders = data?.ladders || []
  return <div className="tcgcb">
    <section>
      <header className="tcgcb-head"><Trophy size={18} /><div><h2>{t('Trait collections')}</h2>
        <p>{t('Cards with your favorite tags and the ones that are your type, across every release.')}</p></div></header>
      {traits.length
        ? <div className="tcgcb-grid">{traits.map(trait => <TraitCollection key={trait.id} trait={trait} />)}</div>
        : <p className="tcgcb-quiet">{t('Star a tag you love, or keep watching so the Vault learns your type.')}</p>}
    </section>
    <section>
      <header className="tcgcb-head"><Trophy size={18} /><div><h2>{t('Spice ladders')}</h2>
        <p>{t('Own one of her cards at every Spice level she has. A ladder appears once you own one of her cards.')}</p></div></header>
      {ladders.length
        ? <div className="tcgcb-ladders">{ladders.map(ladder => <SpiceLadder key={ladder.creator_id} ladder={ladder} />)}</div>
        : <p className="tcgcb-quiet">{t('No ladders yet.')}</p>}
    </section>
  </div>
}

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useT } from '../../../i18n'
import { Section } from './inspectorMeta'

// What's in the source file, read through the tag roles: looks, content and
// framing, each sorted by how sure the tagger is. The full raw list (with the
// low-confidence tags the Spice rules use) is one click away.

const ROLE_TITLES = { looks: 'Looks', content: 'Content', framing: 'Framing' }

function Trait({ trait, onOpen }) {
  const t = useT()
  const percent = trait.confidence == null ? null : Math.round(trait.confidence * 100)
  return <button type="button" className={`tcgcw-trait${trait.manual ? ' is-manual' : ''}`} onClick={() => onOpen(trait)}
                 title={t('Show files tagged {tag}', { tag: trait.name })}>
    <span>{trait.name}</span>
    {trait.manual ? <small>{t('yours')}</small> : <small>{percent}%</small>}
    {percent != null && <i style={{ width: `${percent}%` }} />}
  </button>
}

export default function ContentTab({ detail }) {
  const t = useT()
  const navigate = useNavigate()
  const [showAll, setShowAll] = useState(false)
  const traits = detail.profile?.traits || {}
  const openTag = tag => navigate(`/images?tag_ids=${tag.id}`)
  const groups = Object.entries(ROLE_TITLES).filter(([role]) => traits[role]?.length)
  const all = [...(detail.tags || [])].sort((a, b) => (a.source === 'manual' ? -1 : 0) - (b.source === 'manual' ? -1 : 0) || (b.confidence ?? 1) - (a.confidence ?? 1))
  return <div className="tcgcw-stack">
    {groups.length === 0 && <p className="tcgcw-quiet">{t('The source file has no tags yet. Run AI Tagging to fill this in.')}</p>}
    {groups.map(([role, title]) => <Section key={role} title={t(title)}>
      <div className="tcgcw-traits">{traits[role].map(trait => <Trait key={trait.id} trait={trait} onOpen={openTag} />)}</div>
    </Section>)}
    {all.length > 0 && <Section title={t('All tags')} aside={<button type="button" className="tcgcw-link" onClick={() => setShowAll(v => !v)}>
      {showAll ? t('Hide') : t('Show all {count}', { count: all.length })}</button>}>
      {showAll && <div className="tcgcw-chips">{all.map(tag => <span key={`${tag.id}-${tag.source}`} className={`tcgcw-chip${tag.source === 'manual' ? ' is-manual' : ''}`}>
        {tag.name}<small>{tag.source === 'manual' ? t('yours') : `${Math.round((tag.confidence ?? 0) * 100)}%`}</small></span>)}</div>}
    </Section>}
  </div>
}

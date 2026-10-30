import { useT } from '../../i18n'
import { Archive, Copy, Target, Sparkles } from 'lucide-react'

function Chip({ icon: Icon, children, title, onClick }) {
  const Tag = onClick ? 'button' : 'div'
  return <Tag type={onClick ? 'button' : undefined} onClick={onClick} title={title}
              className={`tcgws-chip${onClick ? ' is-clickable' : ''}`}>
    <Icon size={15} aria-hidden="true" />{children}
  </Tag>
}

function Progress({ percent }) {
  const value = Math.max(0, Math.min(100, Number(percent) || 0))
  return <i className="tcgws-chip__bar" aria-hidden="true"><b style={{ width: `${value}%` }} /></i>
}

// Progress you can actually move: the newest release and your closest set,
// instead of a share of the whole catalogue that stays near 0% for years.
export default function TCGSummaryBar({ summary, onOpenRelease, onOpenSet }) {
  const t = useT()
  const release = summary?.current_release
  const nearest = summary?.nearest_set
  const releaseCompletion = release?.completion
  return (
    <div className="tcgws-summary-chips">
      <Chip icon={Archive}><span>{t('Owned')}</span><strong>{Number(summary?.owned_printings || 0).toLocaleString()}</strong></Chip>
      {Number(summary?.duplicates || 0) > 0 && <Chip icon={Copy}><span>{t('Duplicates')}</span><strong>{Number(summary.duplicates).toLocaleString()}</strong></Chip>}
      {release && releaseCompletion && <Chip icon={Sparkles} onClick={onOpenRelease ? () => onOpenRelease(release.id) : undefined}
                                             title={t('Open {name}', { name: release.name })}>
        <span>{release.name}</span>
        <strong>{Number(releaseCompletion.base_owned || 0).toLocaleString()} / {Number(releaseCompletion.base_total || 0).toLocaleString()}</strong>
        <Progress percent={releaseCompletion.percent} />
      </Chip>}
      {nearest && <Chip icon={Target} onClick={onOpenSet ? () => onOpenSet(nearest.id, nearest.release_id) : undefined}
                        title={t('Closest set to completion')}>
        <span>{t('Closest set')}: {nearest.name}</span>
        <strong>{nearest.owned} / {nearest.total}</strong>
        <Progress percent={nearest.percent} />
      </Chip>}
    </div>
  )
}

import { useState } from 'react'
import { Target } from 'lucide-react'
import { useT } from '../../i18n'
import { companionApi } from '../../lib/api'
import './PullReaction.css'

// Erika's line about the pack you just opened, and how far it pushed this
// week's card bounties. The line is fixed per pull (see services/pull_events).
export default function PullReaction({ reaction, bounties = [] }) {
  const t = useT()
  const [avatarFailed, setAvatarFailed] = useState(false)
  if (!reaction?.text && !bounties.length) return null
  return <div className="pull-reaction">
    {reaction?.text && <div className="pull-reaction__erika">
      {avatarFailed
        ? <span className="pull-reaction__avatar is-fallback">E</span>
        : <img className="pull-reaction__avatar" src={companionApi.avatarUrl()} alt="Erika" onError={() => setAvatarFailed(true)} />}
      <p><strong>Erika</strong>{reaction.text}</p>
    </div>}
    {bounties.length > 0 && <div className="pull-reaction__bounties">
      {bounties.map(bounty => <span key={bounty.title} className={bounty.completed ? 'is-done' : ''}>
        <Target size={15} />{bounty.title}<b>{bounty.completed ? t('Done!') : `${bounty.progress} / ${bounty.target}`}</b>
      </span>)}
    </div>}
  </div>
}

import React from 'react'
import { useT } from '../i18n'
import './card-creator-names.css'

export default function CardCreatorNames({ creators = [], colors = {}, isMix = false }) {
  const t = useT()
  return <div className="card-creator-names" aria-label={t('Creators')}>
    {creators.slice(0, 2).map((creator, index) => (
      <div key={creator.id} className="card-creator-name-row"
           style={{ color: colors[creator.creator_type] || 'var(--c-text)' }}>
        <span className="card-creator-dot" aria-hidden="true" />
        <span className="card-creator-name" title={creator.name}>{creator.name}</span>
        {index === 1 && creators.length > 2 && <span className="card-creator-more"
          title={creators.slice(2).map(c => c.name).join(', ')}>+{creators.length - 2}</span>}
      </div>
    ))}
    {isMix && <span className="card-creator-mix">{t('Mix')}</span>}
  </div>
}
